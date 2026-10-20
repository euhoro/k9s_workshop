# Understanding the Kubernetes todo application

This guide explains the system using the Feynman technique: describe each part
in plain language, follow one real request, and then check whether you can teach
it back without relying on Kubernetes vocabulary alone.

## 1. The application before Kubernetes

There are three programs:

1. **Frontend:** Nginx serves static HTML, CSS, configuration, and JavaScript.
2. **Backend:** Node.js exposes CRUD HTTP endpoints and runs SQL queries.
3. **Database:** PostgreSQL permanently stores todo rows.

CRUD means Create, Read, Update, and Delete:

| HTTP request | Operation |
|---|---|
| `POST /api/todos` | Create |
| `GET /api/todos` | Read |
| `PATCH /api/todos/:id` | Update/toggle |
| `DELETE /api/todos/:id` | Delete |

## 2. Outside-to-inside traffic

```text
Your browser
  |
  | HTTP to localhost:8000
  v
k3d load balancer (host port 8000 -> cluster port 80)
  |
  v
Traefik Ingress controller
  |
  +-- path starts with /api -------------------------------+
  |                                                        |
  |   Ingress rule                                         v
  |   -> Service/homework-backend:3000              backend Pod(s)
  |                                                        |
  |                                                        | PostgreSQL TCP
  |                                                        v
  |                                               Service/homework-postgres:5432
  |                                                        |
  |                                                        v
  |                                                  PostgreSQL Pod
  |                                                        |
  |                                                        v
  |                                             PersistentVolumeClaim
  |
  +-- every other path (/) -------------------------------+
                                                           |
      Ingress rule                                         v
      -> Service/homework-frontend:80                frontend Pod(s)
```

The database has no branch from the outside. Only the backend knows its Service
name and credentials.

### Is “Traefik” misspelled?

No. **Traefik** is the official name of the reverse proxy/Ingress controller
bundled with k3s. The spelling is a brand name; it is pronounced approximately
like “traffic.” An `Ingress` is a Kubernetes routing object. Traefik is the
program that reads that object and performs the routing.

## 3. Why the frontend has no backend hostname

Nginx only serves files; it does not make the API request. The JavaScript
running in the user's browser does that.

The setting is in `frontend/config.js`:

```js
window.APP_CONFIG = {
  apiPrefix: "/api",
};
```

`frontend/app.js` then uses the configured prefix:

```js
fetch(`${apiPrefix}/todos`)
```

`/api` is a relative path on the same origin. If the page came from
`http://localhost:8000`, the browser requests
`http://localhost:8000/api/todos`. If the app later moves to
`https://todos.example.com`, the browser automatically requests
`https://todos.example.com/api/todos`. No hostname or port is hardcoded and no
cross-origin (CORS) setup is needed.

Three settings must agree:

```text
frontend config.js:             /api
Ingress backend path:           /api
backend API_PREFIX environment: /api
```

## 4. Kubernetes objects in this project

A Kubernetes object is a desired-state record submitted to the Kubernetes API.
The controller tries to make reality match that record.

### Namespace

`homework-todo` groups and isolates the homework resources. Selecting this
namespace in k9s hides unrelated cluster workloads.

### Pod

A Pod is Kubernetes' smallest scheduling unit. Here each Pod runs one
container. Pods are disposable: their names, IP addresses, and local writable
files can disappear when they are replaced.

### Deployment

A Deployment says which Pod template to run and how many replicas should
exist. If a backend Pod dies, its Deployment creates another. It also performs
rolling updates when the image or Pod template changes.

### Service and ClusterIP

A Service gives a changing group of Pods one stable virtual IP and DNS name.
All three Services use the default `ClusterIP` type because their direct
clients are inside the cluster:

- Ingress reaches `homework-frontend` and `homework-backend` internally.
- The backend reaches `homework-postgres` internally.

The frontend and backend still become public **through Ingress**. Their Services
do not need to be public themselves. PostgreSQL has no Ingress rule, NodePort,
or LoadBalancer, so it is not reachable through the cluster's external entry
point.

`ClusterIP` is mainly about internal exposure. Stable Service DNS is available
for other Service types too. Within this namespace, the database can be reached
as `homework-postgres`; its full DNS name is:

```text
homework-postgres.homework-todo.svc.cluster.local
```

### Selector and label

A **label** is a key/value tag attached to an object. A **selector** is a query
that chooses objects with matching labels.

The backend Pods receive this label from their Deployment template:

```yaml
labels:
  app: homework-backend
```

The backend Service uses this selector:

```yaml
selector:
  app: homework-backend
```

Kubernetes finds all ready Pods with that label and creates Service endpoints
for their IP addresses. With two matching backend Pods, the Service distributes
connections between both. When a Pod is replaced, its new IP is automatically
added and the old one removed. The Service name and IP remain stable.

Deployment selectors also connect a Deployment to the Pods it owns. Therefore
the Deployment's selector must match the labels in its Pod template.

### Ingress

Ingress contains HTTP routing rules. The longer `/api` prefix goes to the
backend Service; `/` catches all other paths and goes to the frontend Service.
Both therefore share one public IP, scheme, hostname, and port.

### Secret

The `homework-postgres-credentials` Secret contains database name, username,
and password. `envFrom.secretRef` injects the same keys as environment variables
into both PostgreSQL and the backend. “Sharing the Secret” means both workloads
reference the same Secret object; it does not mean making the database public.

### PVC, PV, and StorageClass

PVC means **PersistentVolumeClaim**. It is a request for storage, not the disk
itself:

```text
PostgreSQL container
  -> mounts volume at /var/lib/postgresql/data
  -> Pod refers to homework-postgres-data PVC
  -> PVC is bound to a PersistentVolume (PV)
  -> k3s local-path StorageClass supplies storage on a k3d node
```

The Pod is disposable, but the PVC/PV lifecycle is separate. Replacing only
the PostgreSQL Pod reattaches the same stored files, which is why the todo
survived our test. In this local-path lab, deleting the PVC or whole k3d cluster
can delete the data. Production clusters usually use network or cloud disks so
storage is not tied to one local node.

### Readiness and liveness probes

- **Liveness:** “Is the application process alive?” If it fails repeatedly,
  Kubernetes restarts the container.
- **Readiness:** “Can this Pod serve traffic right now?” If it fails, Kubernetes
  removes the Pod from Service endpoints until it recovers.

The backend's `/live` endpoint does not require PostgreSQL. `/health` checks the
database too. Thus a database outage makes the backend unready without
needlessly restarting a healthy Node.js process.

### Resource requests and limits

Requests help the scheduler choose a node with enough capacity. Limits cap
container memory use. These examples are intentionally small for a local lab.

## 5. Why committing this Secret is a caveat

`secret.yaml` contains a plain development password under `stringData`.
Kubernetes converts it to base64 in the API, but **base64 is encoding, not
encryption**. Anyone who can read the Git repository can see this credential,
and anyone with sufficient Kubernetes RBAC permissions can retrieve and decode
the Secret.

Common production approaches include:

1. **External secret manager:** store values in AWS Secrets Manager, Azure Key
   Vault, Google Secret Manager, or HashiCorp Vault. External Secrets Operator
   synchronizes only the needed values into Kubernetes.
2. **Encrypted Git workflow:** encrypt secret manifests using SOPS (often with
   cloud KMS or age) or use Sealed Secrets. Git contains ciphertext, and only
   the cluster/deployment identity can decrypt it.
3. **CI/CD injection:** keep credentials in protected CI variables and run
   `kubectl create secret` during deployment rather than committing a secret
   file.

Production clusters should also enable encryption at rest for Secrets in etcd,
use least-privilege RBAC, restrict Pod access, rotate credentials, and avoid
printing them in logs. For this local homework, the committed value is explicit
and reproducible but must never be reused as a real password.

## 6. Deploy, observe, and remove

The exact commands are in [README.md](README.md). The key mental model is:

```text
docker build        creates images in Docker
k3d image import    makes those images available to k3s/containerd
kubectl apply -k    submits the desired Kubernetes objects
kubectl get         observes current state
kubectl logs        observes application output
kubectl delete -k   removes the submitted objects
```

## 7. Teach-back checklist

You understand this homework sufficiently when, without reading the answers,
you can:

1. Trace `/` and `/api/todos` from the browser to different Pods.
2. Explain how a Service selector finds Pods and survives changing Pod IPs.
3. Explain why all Services can be ClusterIP while two apps remain public.
4. Distinguish a Pod's temporary filesystem, PVC, PV, and StorageClass.
5. Explain why Secret YAML in Git is unsafe and name one production solution.
6. Explain the different failure responses of readiness and liveness probes.
7. Build, import, deploy, inspect, test, and remove the app using the README.
