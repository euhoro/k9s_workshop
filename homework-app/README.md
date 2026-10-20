# Kubernetes three-tier todo homework

This project deploys a working frontend, backend, and PostgreSQL database on
k3d. Start with [EXPLANATION.md](EXPLANATION.md) for the complete teaching
guide, architecture, traffic flow, selectors, storage, Secrets, and probes.

## Result

- UI: <http://localhost:8000/>
- API: <http://localhost:8000/api/todos>
- Namespace: `homework-todo`
- Public entry point: one Traefik Ingress
- Private database: `ClusterIP` only
- Persistent data: 1 GiB PVC
- Shared credentials: Kubernetes Secret

## Assignment answers

- **How is the frontend exposed?** Traefik Ingress routes `/` to the internal
  `homework-frontend` ClusterIP Service.
- **How does the frontend reach the backend?** Browser JavaScript requests the
  same origin under `/api`; Ingress routes that prefix to `homework-backend`.
- **Why do they share one DNS/IP?** One Ingress accepts both paths and makes a
  Layer-7 routing decision instead of allocating one external address per app.
- **Why is PostgreSQL not externally accessible?** It has only a ClusterIP
  Service and no Ingress, NodePort, or LoadBalancer route.
- **How does the backend reach PostgreSQL?** It uses the stable Service DNS name
  `homework-postgres` and credentials injected from the shared Secret.
- **Why does data survive PostgreSQL Pod replacement?** `/var/lib/postgresql/data`
  is mounted from a PVC bound to storage whose lifecycle is separate from the
  Pod.
- **Why is the committed Secret only a demonstration?** Its password is visible
  in Git; base64 Kubernetes Secret storage is encoding, not encryption. See
  `EXPLANATION.md` for External Secrets, SOPS, Sealed Secrets, and CI/CD options.

## Deploy it yourself

From the repository root:

```bash
# 1. Build the two images.
docker build -t homework-todo-backend:1.1 homework-app/backend
docker build -t homework-todo-frontend:1.1 homework-app/frontend

# 2. Copy local Docker images into k3d's container runtime.
k3d image import homework-todo-backend:1.1 homework-todo-frontend:1.1 -c k3s-default

# 3. Create or update all Kubernetes objects.
kubectl apply -k homework-app/k8s

# 4. Wait until each layer is ready.
kubectl rollout status deployment/homework-postgres -n homework-todo
kubectl rollout status deployment/homework-backend -n homework-todo
kubectl rollout status deployment/homework-frontend -n homework-todo
```

The existing cluster maps host port `8000` to its load balancer's port `80`.
For a brand-new equivalent cluster:

```bash
k3d cluster create k3s-default --agents 2 --port '8000:80@loadbalancer'
```

## Inspect it

```bash
kubectl get all,ingress,pvc,secret -n homework-todo
kubectl describe ingress homework-todo -n homework-todo
kubectl get endpointslices -n homework-todo
kubectl logs deployment/homework-backend -n homework-todo
```

In k9s, type `:ns`, select `homework-todo`, and press Enter. All application
resource names also begin with `homework-`.

## Test it

```bash
# Frontend
curl http://localhost:8000/

# Read todos
curl http://localhost:8000/api/todos

# Create a todo
curl -X POST -H 'Content-Type: application/json' \
  -d '{"text":"Learn Kubernetes"}' \
  http://localhost:8000/api/todos
```

You can also open <http://localhost:8000/> and create, complete, and delete
todos in the browser.

## Remove it

Delete exactly the resources declared by this homework:

```bash
kubectl delete -k homework-app/k8s
```

Because everything is in its own namespace, this is also sufficient:

```bash
kubectl delete namespace homework-todo
```

Namespace deletion also deletes its PVC and the locally provisioned database
data. It does not delete the Docker images or the k3d cluster. To remove the
local images afterward:

```bash
docker image rm homework-todo-backend:1.1 homework-todo-frontend:1.1
```

Do not run `k3d cluster delete k3s-default` unless you intend to remove the
entire shared learning cluster and everything deployed in it.
