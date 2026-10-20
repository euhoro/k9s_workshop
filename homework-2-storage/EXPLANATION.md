# Understanding database persistence in Kubernetes

## The experiment

```text
Stage 1

Redis process -> container writable layer
                       |
                       X  deleted with the Pod

Stage 2

homework2-redis-0 -> PVC 0 -> PV 0
       primary
          |
          | Redis replication
          v
homework2-redis-1 -> PVC 1 -> PV 1
       replica
```

## Why stage 1 loses data

A container has a writable filesystem, but it belongs to that particular
container. A Deployment replaces a deleted Pod with a new Pod and new
container. Kubernetes recreates the program, not the deleted container's
files. Stage 1 disables Redis snapshots and append-only persistence so that the
loss is immediate and unambiguous.

## Volume, PV, and PVC

- A **volume** is storage mounted into a Pod at a filesystem path.
- A **PersistentVolume (PV)** is the actual cluster storage resource.
- A **PersistentVolumeClaim (PVC)** is a workload's request for storage.
- A **StorageClass** knows how to create suitable PVs automatically.

The relationship is:

```text
Container /data directory
       |
       v
Pod volume declaration
       |
       v
PVC: "I need 1 GiB, ReadWriteOnce"
       |
       v
StorageClass dynamically creates and binds a PV
```

We do not hand-write PV YAML because k3d's default `local-path` StorageClass
dynamically provisions one PV for each claim. `kubectl get pv` proves those PV
objects exist.

## Why use a StatefulSet?

A Deployment treats replicas as interchangeable. A StatefulSet gives every
replica a stable identity:

```text
Pod identity             Storage identity
homework2-redis-0   <->  data-homework2-redis-0
homework2-redis-1   <->  data-homework2-redis-1
```

When `homework2-redis-0` is replaced, it keeps ordinal `0` and reattaches claim
`data-homework2-redis-0`. This is useful for stateful software that needs a
predictable identity and its own persistent disk.

## Headless Service and stable DNS

The Service sets `clusterIP: None`, which makes it **headless**. Rather than
giving clients one load-balanced virtual IP, DNS exposes the individual
StatefulSet Pods. The replica can consistently find the primary at:

```text
homework2-redis-0.homework2-redis-headless
```

The Pod IP may change; its StatefulSet DNS identity remains stable.

## What does “share it with two instances” safely mean?

It should mean that both database instances contain the same logical dataset,
using the database's replication protocol. It should not mean that two database
processes concurrently modify the same raw files.

Most databases assume exclusive control over their data directory. Mounting one
ReadWriteMany filesystem into two independent PostgreSQL, MySQL, or Redis
processes can cause lock conflicts, inconsistent caches, and corrupted data.

This lab therefore uses:

```text
primary database files on PV 0
              |
              | database-aware replication
              v
replica database files on PV 1
```

The two instances share **data**, not **data files**.

## ReadWriteOnce does not mean one Pod

`ReadWriteOnce` means a volume may be mounted read-write by nodes in a way
supported by the storage driver. It is commonly described as “one node,” not
strictly “one Pod.” It is not a database-coordination mechanism. Even if a
storage system technically permits two Pods to mount a volume, the database
still needs a supported clustering or replication design.

## Limits of this learning topology

The primary is fixed as ordinal `0`; there is no automatic failover or replica
promotion. A real highly available Redis system would normally use Redis
Sentinel, Redis Cluster, or an operator/chart that manages elections, failover,
authentication, backups, and disruption rules. Two instances are useful for
this storage lesson but are not a production HA design.

## Understanding checklist

You understand the exercise when you can explain:

1. Why a replacement Deployment Pod does not inherit container-local files.
2. How a PVC is bound to a PV and mounted into a Pod.
3. Why a StatefulSet Pod reuses the correct PVC after replacement.
4. Why the two instances need separate PVCs.
5. How the replica finds the primary despite changing Pod IPs.
