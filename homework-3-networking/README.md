# Homework 3: ClusterIP, NodePort, LoadBalancer, and Ingress

This lab deploys a complete three-tier todo application: an Nginx frontend, a
Node.js backend, and PostgreSQL. It then exposes the two frontend Pods four
different ways. Follow the parts in order because all three Service files
modify the same frontend Service named `homework3-server`.

Read [EXPLANATION.md](EXPLANATION.md) for diagrams and the reasoning behind each
networking type.

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
