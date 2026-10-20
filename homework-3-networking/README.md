# Homework 3: ClusterIP, NodePort, LoadBalancer, and Ingress

This lab deploys a complete three-tier todo application: an Nginx frontend, a
Node.js backend, and PostgreSQL. It then exposes the two frontend Pods four
different ways. Follow the parts in order because all three Service files
modify the same frontend Service named `homework3-server`.

Read [EXPLANATION.md](EXPLANATION.md) for diagrams and the reasoning behind each
networking type.

## Why this homework uses Kustomize

`kubectl` includes Kustomize, which assembles several Kubernetes YAML files into
one declared application. The `k8s/kustomization.yaml` file lists the resources
that make up Homework 3's final recommended state:

```text
namespace
+ PostgreSQL, Secret, and PVC
+ backend
+ frontend
+ frontend ClusterIP Service
+ Ingress
= final application
```

Deploy or update that complete final state with one idempotent command:

```bash
kubectl apply -k homework-3-networking/k8s
```

Kustomize renders ordinary Kubernetes objects before sending them to the API;
it is not another process running in the cluster. It reduces forgotten files,
keeps the deploy command reproducible, and can also support environment overlays
without copying whole manifests. The NodePort and LoadBalancer YAML files are
deliberately not in `kustomization.yaml`: they temporarily replace the frontend
Service during Parts 2 and 3 rather than belonging to the final state.

## Different configuration for dev and staging

The `k8s/` directory is the shared **base**. Environment overlays import that
base and declare only their differences:

```text
homework-3-networking/
├── k8s/                    shared final-state resources
│   └── kustomization.yaml
└── overlays/
    ├── dev/
    │   └── kustomization.yaml
    └── stg/
        └── kustomization.yaml
```

The included examples render these settings:

| Setting | Dev | Staging |
|---|---|---|
| Namespace | `homework3-dev` | `homework3-stg` |
| Ingress host | `homework3.dev.local` | `homework3.stg.local` |
| Frontend replicas | 1 | 2 |
| Backend replicas | 1 | 3 |
| PostgreSQL replicas | 1 | 1 |
| Environment label | `environment=dev` | `environment=stg` |

Preview the fully rendered YAML without changing the cluster:

```bash
kubectl kustomize homework-3-networking/overlays/dev
kubectl kustomize homework-3-networking/overlays/stg
```

Deploy one environment:

```bash
kubectl apply -k homework-3-networking/overlays/dev
# or
kubectl apply -k homework-3-networking/overlays/stg
```

Because the namespaces and hostnames differ, dev and staging can run together
without their namespaced Deployments, Services, PVCs, or Secrets colliding.
For local browser access, add the chosen hostname to `/etc/hosts`:

```text
127.0.0.1 homework3.dev.local
127.0.0.1 homework3.stg.local
```

Remove only one environment with:

```bash
kubectl delete -k homework-3-networking/overlays/dev
# or
kubectl delete -k homework-3-networking/overlays/stg
```

### Environment-specific secrets

The learning overlays currently inherit the committed demo Secret so they stay
self-contained. Real dev and staging environments must not store plaintext
password patches in Git. Instead, give each environment a separate external
secret-manager path, for example:

```text
/k9s-workshop/dev/postgres  -> Secret in homework3-dev
/k9s-workshop/stg/postgres  -> Secret in homework3-stg
```

External Secrets, SOPS/Sealed Secrets, or CI/CD should create the same Secret
name (`homework3-postgres-credentials`) in each namespace with different values.
The Deployments remain unchanged because they depend on the Secret's name and
keys, not on where the values came from.

## Assignment answers

- **Why ClusterIP?** It gives the selected Pods a stable virtual IP and DNS name
  reachable by other cluster workloads without opening an external port.
- **How is NodePort different?** It retains internal Service networking and also
  opens one high port on every node. It is rarely the final public interface
  because clients must manage node addresses/ports and it provides no HTTP
  routing or TLS management. It remains useful for labs, debugging, bare metal,
  or as a building block beneath another load balancer.
- **How is LoadBalancer different?** It asks the platform to provide an external
  address/load balancer. Local k3s uses ServiceLB helper Pods and Docker-node
  addresses; a managed cloud provisions a real provider load balancer, network
  rules, and a public or private address, normally with additional cost.
- **Why add Ingress if a load balancer already accepts traffic?** A basic load
  balancer usually forwards at Layer 4 using IP and port. Ingress understands
  Layer-7 HTTP hostnames and paths, so many applications can share one external
  entry point.
- **What else can Ingress provide?** Central TLS termination, redirects, and
  controller-dependent authentication, rate limits, rewrites, retries, and
  header policies.
- **Why are the backend and database always ClusterIP?** Only the frontend
  Service is changed during Parts 1–3. The browser reaches the backend through
  the final Ingress `/api` rule, and only the backend needs direct database
  access. Neither internal layer needs its own NodePort or LoadBalancer.

## Build the backend image

Homework 3 reuses the tested Node.js backend source from Homework 1:

```bash
docker build -t homework-todo-backend:1.1 homework-app/backend
k3d image import homework-todo-backend:1.1 -c k3s-default
```

## Deploy the three application layers

From the repository root:

```bash
kubectl apply -f homework-3-networking/k8s/namespace.yaml
kubectl apply -f homework-3-networking/k8s/backend-database.yaml
kubectl apply -f homework-3-networking/k8s/deployment.yaml
kubectl rollout status deployment/homework3-postgres -n homework3-networking
kubectl rollout status deployment/homework3-backend -n homework3-networking
kubectl rollout status deployment/homework3-server -n homework3-networking
kubectl get pods,service,pvc -n homework3-networking -o wide
```

The layers are:

- `homework3-server`: two Nginx frontend Pods;
- `homework3-backend`: two Node.js CRUD API Pods;
- `homework3-postgres`: one PostgreSQL Pod with a 1 GiB PVC.

After learning the individual files, the equivalent one-command deployment is:

```bash
kubectl apply -k homework-3-networking/k8s
```

## Secret handling: lab versus production

The backend and PostgreSQL both reference `homework3-postgres-credentials`.
This keeps credentials out of the Deployment specifications and ensures both
components receive the same database name, username, and password.

For this reproducible local lab, the example password is committed under
`stringData` in `backend-database.yaml`. That is **not production-safe**. The
Kubernetes API normally displays Secret data as base64, but base64 is reversible
encoding rather than encryption. Anyone who can read the repository—or has
sufficient Kubernetes RBAC access—can obtain the password.

Common production approaches are:

- store credentials in AWS Secrets Manager, Azure Key Vault, Google Secret
  Manager, or HashiCorp Vault and synchronize them with External Secrets;
- commit only encrypted values using SOPS or Sealed Secrets;
- inject a Secret from protected CI/CD variables during deployment.

Production clusters should also enable Secret encryption at rest, use
least-privilege RBAC, rotate credentials, and avoid printing secrets in logs.

## How a request travels through the application

There are two related but different request paths: loading the UI and using the
API. The UI is JavaScript running in the user's browser after Nginx sends it.

### 1. Loading the UI

```text
Browser requests http://homework3.local:8000/
  |
  v
k3d load balancer maps host port 8000 to cluster port 80
  |
  v
Traefik receives HTTP Host=homework3.local and Path=/
  |
  | Ingress rule: / -> homework3-server:8088
  v
homework3-server ClusterIP Service
  |
  | selector app=homework3-server chooses a ready endpoint
  v
one Nginx frontend Pod on container port 80
  |
  v
HTML and JavaScript return to the browser
```

The Service stays stable while its two frontend Pod names and IP addresses can
change. Kubernetes maintains the Service's EndpointSlices from matching labels.

### 2. Reading todos after the page loads

The downloaded JavaScript calls `fetch('/api/todos')`:

```text
JavaScript in browser sends GET /api/todos
  |
  v
k3d load balancer -> Traefik
  |
  | Ingress chooses the more specific /api rule
  v
homework3-backend ClusterIP Service on port 3000
  |
  | selector app=homework3-backend
  v
one ready Node.js backend Pod
  |
  | SQL: SELECT * FROM todos
  | DB_HOST=homework3-postgres
  v
Kubernetes DNS resolves the homework3-postgres Service
  |
  v
homework3-postgres ClusterIP Service on port 5432
  |
  | selector app=homework3-postgres
  v
PostgreSQL Pod reads rows from its database files on the PVC
  |
  v
PostgreSQL -> Node.js -> Traefik -> browser JavaScript -> rendered list
```

Nginx is not in the `/api` request path. Its job was to deliver the UI files;
the JavaScript running in the browser contacts the same public address directly.

### 3. Creating a todo

When the user submits the form, the route is the same but the operation changes:

```text
UI form
  -> JavaScript sends POST /api/todos with JSON
  -> Traefik routes /api to homework3-backend
  -> backend validates the text
  -> backend executes INSERT INTO todos ...
  -> PostgreSQL updates its files through the mounted PVC
  -> PostgreSQL returns the new row
  -> backend returns JSON with HTTP 201
  -> JavaScript reloads and displays the list
```

The PVC is not a network hop. It is storage mounted into the PostgreSQL Pod at
`/var/lib/postgresql/data`. PostgreSQL alone reads and writes those files.

### Complete architecture

```text
                          one public host/address
Browser UI              homework3.local:8000
    |                              |
    +--------------------------> Traefik
                                   |
                 +-----------------+------------------+
                 | Path /                             | Path /api
                 v                                    v
       frontend ClusterIP Service          backend ClusterIP Service
                 |                                    |
          +------+------+                      +------+------+
          |             |                      |             |
       Nginx 1       Nginx 2                Node.js 1     Node.js 2
                                                       |
                                                       v
                                            PostgreSQL ClusterIP
                                                       |
                                                       v
                                                  PostgreSQL
                                                       |
                                                       v
                                                      PVC
```

## Part 1: ClusterIP

```bash
kubectl apply -f homework-3-networking/k8s/part-1-clusterip.yaml
kubectl get service homework3-server -n homework3-networking
```

Test from a temporary Pod inside the cluster:

```bash
kubectl run homework3-client --rm -i --restart=Never \
  --image=curlimages/curl:8.12.1 -n homework3-networking -- \
  curl --fail http://homework3-server:8088/
```

The Service DNS name works inside the cluster. It creates no host port.

## Part 2: NodePort

```bash
kubectl apply -f homework-3-networking/k8s/part-2-nodeport.yaml
kubectl get service homework3-server -n homework3-networking
kubectl get nodes -o wide
```

The Service opens port `30088` on every Kubernetes node. From a network that
can reach a node IP, request `http://NODE_IP:30088/`.

With k3d, nodes are Docker containers. Their ports are not automatically
published to the host, so `localhost:30088` generally does not work unless that
port was mapped when the cluster was created. Test through a node from inside:

```bash
NODE_IP=$(kubectl get node -o jsonpath='{.items[0].status.addresses[?(@.type=="InternalIP")].address}')
kubectl run homework3-client --rm -i --restart=Never \
  --image=curlimages/curl:8.12.1 -n homework3-networking -- \
  curl --fail "http://${NODE_IP}:30088/"
```

## Part 3: LoadBalancer

```bash
kubectl apply -f homework-3-networking/k8s/part-3-loadbalancer.yaml
kubectl get service homework3-server -n homework3-networking -w
```

Stop watching with `Ctrl-C` after an external address appears. In k3d/k3s,
ServiceLB creates local helper Pods and advertises node/container addresses. A
managed cloud normally asks the cloud provider to provision a real external
load balancer, firewall rules, and a public or private address. Cloud resources
can incur cost.

## Part 4: Ingress

Return the application Service to internal-only `ClusterIP`, then add Ingress:

```bash
kubectl apply -f homework-3-networking/k8s/part-1-clusterip.yaml
kubectl apply -f homework-3-networking/k8s/part-4-ingress.yaml
kubectl get service,ingress -n homework3-networking
```

The existing k3d cluster maps host port `8000` to Traefik. Test host-based
routing without changing DNS:

```bash
curl --fail -H 'Host: homework3.local' http://localhost:8000/
```

Test the backend path through the same Ingress:

```bash
curl --fail -H 'Host: homework3.local' \
  http://localhost:8000/api/todos

curl --fail -H 'Host: homework3.local' \
  -H 'Content-Type: application/json' \
  -d '{"text":"Understand Kubernetes networking"}' \
  http://localhost:8000/api/todos
```

For browser access, add this local hosts entry (requires administrator access):

```text
127.0.0.1 homework3.local
```

Then open <http://homework3.local:8000/>.

## Inspect in k9s

Open k9s, type `:ns`, and select `homework3-networking`. Useful views:

- `:deploy` — Deployment
- `:rs` — ReplicaSet
- `:pods` — Pods
- `:svc` — Services
- `:ing` — Ingress
- `:ep` — Service endpoints

## Remove the homework

```bash
kubectl delete namespace homework3-networking
```
