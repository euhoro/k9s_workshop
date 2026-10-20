# Kubernetes and k9s workshop homeworks

This repository contains three hands-on Kubernetes assignments built and tested
on a local k3d cluster. Each folder includes runnable manifests, exact commands,
a concise answer section, and a longer explanation written for learning rather
than merely submitting the homework.

## Contents

| Folder | Topic | What you learn |
|---|---|---|
| [`homework-app`](homework-app/) | Three-tier todo application | Deployments, Services, Ingress path routing, Secrets, PostgreSQL, PVCs, probes |
| [`homework-2-storage`](homework-2-storage/) | Database persistence | Pod-local data loss, PV/PVC, StatefulSet identity, headless Service, Redis replication |
| [`homework-3-networking`](homework-3-networking/) | Kubernetes networking | ClusterIP, NodePort, LoadBalancer, Ingress, Layer 4 versus Layer 7 |

The recommended order is 1 → 2 → 3. Each homework has:

- `README.md`: deploy, inspect, test, remove, and direct assignment answers;
- `EXPLANATION.md`: diagrams, mental models, caveats, and understanding checks;
- `k8s/`: Kubernetes YAML manifests;
- application code and Dockerfiles where the homework needs custom images.

## Prerequisites

- Docker Desktop or another Docker runtime
- [k3d](https://k3d.io/)
- `kubectl`
- Optional: [k9s](https://k9scli.io/) for terminal-based cluster inspection
- `curl` for HTTP tests

Check the tools:

```bash
docker version
k3d version
kubectl version --client
k9s version
```

## Create the local cluster

The examples expect a cluster called `k3s-default`. Port `8000` on the host is
mapped to port `80` on the k3d load balancer so Traefik Ingress is reachable:

```bash
k3d cluster create k3s-default \
  --agents 2 \
  --port '8000:80@loadbalancer'
```

Confirm it is ready:

```bash
kubectl get nodes
kubectl get ingressclass
```

The expected IngressClass is `traefik`, which k3s installs by default.

## Clone this repository

```bash
git clone https://github.com/euhoro/k9s_workshop.git
cd k9s_workshop
```

## Run Homework 1

Homework 1 builds custom frontend and backend images, so build and import them
before applying the manifests:

```bash
docker build -t homework-todo-backend:1.1 homework-app/backend
docker build -t homework-todo-frontend:1.1 homework-app/frontend
k3d image import homework-todo-backend:1.1 homework-todo-frontend:1.1 \
  -c k3s-default
kubectl apply -k homework-app/k8s
```

Open <http://localhost:8000/>. Continue with
[`homework-app/README.md`](homework-app/README.md) for rollout, testing,
persistence verification, and removal.

## Run Homework 2

Homework 2 is intentionally executed in two stages. First prove that data is
lost without persistent storage, then deploy two persistent Redis instances:

```bash
kubectl apply -f homework-2-storage/k8s/namespace.yaml
kubectl apply -f homework-2-storage/k8s/stage-1-ephemeral.yaml
```

Do not apply both stages at once; follow
[`homework-2-storage/README.md`](homework-2-storage/README.md) to perform the
data-loss experiment before moving to the StatefulSet.

## Run Homework 3

Homework 3 also proceeds in order because each Service manifest changes the
same Service:

```bash
kubectl apply -f homework-3-networking/k8s/namespace.yaml
kubectl apply -f homework-3-networking/k8s/deployment.yaml
kubectl apply -f homework-3-networking/k8s/part-1-clusterip.yaml
```

Follow [`homework-3-networking/README.md`](homework-3-networking/README.md) to
change the Service through ClusterIP → NodePort → LoadBalancer, then return it
to ClusterIP and add Ingress.

## Inspect everything with k9s

```bash
k9s
```

Inside k9s:

1. Type `:ns` to select a namespace.
2. Choose `homework-todo`, `homework2-storage`, or `homework3-networking`.
3. Use `:pods`, `:deploy`, `:sts`, `:svc`, `:pvc`, or `:ing` to inspect the
   relevant resource type.
4. Select a resource and press `d` to describe it or `l` to view logs where
   applicable.

## Remove the homeworks

Each homework has its own namespace, so cleanup is explicit and isolated:

```bash
kubectl delete namespace homework-todo
kubectl delete namespace homework2-storage
kubectl delete namespace homework3-networking
```

Deleting `homework-todo` or `homework2-storage` also deletes their PVCs. With
k3d's default local-path StorageClass and `Delete` reclaim policy, the bound
local PV data is deleted too.

Remove the entire cluster only when you no longer need anything in it:

```bash
k3d cluster delete k3s-default
```

## Learning approach

Do not stop at “the YAML applied.” For every homework, be able to draw the
traffic or storage path, predict what happens when a Pod is deleted, identify
which resource stays stable, and explain why the selected Kubernetes object is
appropriate. The `EXPLANATION.md` files end with teach-back checklists for this
purpose.
