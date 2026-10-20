# Homework 2: database persistence and two instances

This lab first proves that a database Pod without persistent storage loses its
data. It then fixes the problem with Kubernetes volumes and runs two Redis
instances that share logical data through replication.

Read [EXPLANATION.md](EXPLANATION.md) before or alongside the commands.

## Prerequisites

- A running Kubernetes or k3d cluster
- `kubectl` configured for that cluster
- Internet access for the nodes to pull `redis:7.4-alpine`

## Stage 1: prove that Pod-local data is temporary

```bash
kubectl apply -f homework-2-storage/k8s/namespace.yaml
kubectl apply -f homework-2-storage/k8s/stage-1-ephemeral.yaml
kubectl rollout status deployment/homework2-ephemeral-redis \
  -n homework2-storage
```

Write and read a value:

```bash
kubectl exec -n homework2-storage \
  deployment/homework2-ephemeral-redis -- \
  redis-cli SET course kubernetes

kubectl exec -n homework2-storage \
  deployment/homework2-ephemeral-redis -- \
  redis-cli GET course
```

The second command prints `kubernetes`. Find and delete the Pod:

```bash
kubectl get pods -n homework2-storage
kubectl delete pod -n homework2-storage \
  -l app=homework2-ephemeral-redis
kubectl rollout status deployment/homework2-ephemeral-redis \
  -n homework2-storage
```

Read the key again:

```bash
kubectl exec -n homework2-storage \
  deployment/homework2-ephemeral-redis -- \
  redis-cli GET course
```

It prints `(nil)`: the Deployment created a new Pod, but the old Pod's writable
container filesystem disappeared.

Remove stage 1 before continuing:

```bash
kubectl delete -f homework-2-storage/k8s/stage-1-ephemeral.yaml
```

## Stage 2: add persistence and two database instances

```bash
kubectl apply -f homework-2-storage/k8s/stage-2-persistent-replicated.yaml
kubectl rollout status statefulset/homework2-redis -n homework2-storage
kubectl get pods,pvc -n homework2-storage
kubectl get pv
```

The StatefulSet creates:

- `homework2-redis-0`: primary Redis instance with its own PVC
- `homework2-redis-1`: replica Redis instance with its own PVC

Write to the primary and read from both instances:

```bash
kubectl exec -n homework2-storage homework2-redis-0 -- \
  redis-cli SET course kubernetes

kubectl exec -n homework2-storage homework2-redis-0 -- \
  redis-cli GET course

kubectl exec -n homework2-storage homework2-redis-1 -- \
  redis-cli GET course
```

Both reads print `kubernetes`. Redis replication, not a shared filesystem,
copies the logical data from the primary to the replica.

## Prove that the PVC preserves data

Delete the primary Pod:

```bash
kubectl delete pod homework2-redis-0 -n homework2-storage
kubectl wait --for=condition=Ready pod/homework2-redis-0 \
  -n homework2-storage --timeout=120s

kubectl exec -n homework2-storage homework2-redis-0 -- \
  redis-cli GET course
```

The value remains because the replacement `homework2-redis-0` Pod reuses its
original PVC.

## Remove the homework

```bash
kubectl delete namespace homework2-storage
```

Deleting the namespace deletes the StatefulSet, Pods, Services, and PVCs. With
the default k3d `local-path` StorageClass and its `Delete` reclaim policy, the
dynamically provisioned PVs and their data are deleted as well.
