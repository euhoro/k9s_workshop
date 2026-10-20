# Understanding Kubernetes network exposure

## The application stack

Homework 3 now uses three layers:

```text
Browser
  |
  v
Traefik Ingress
  |
  +-- / ----------------> homework3-server Service
  |                              |
  |                              +--> Nginx frontend Pod 1
  |                              +--> Nginx frontend Pod 2
  |
  +-- /api -------------> homework3-backend Service
                                 |
                                 +--> Node.js backend Pod 1
                                 +--> Node.js backend Pod 2
                                            |
                                            v
                                  homework3-postgres Service
                                            |
                                            v
                                      PostgreSQL Pod
                                            |
                                            v
                                           PVC
```

The Nginx frontend serves HTML and browser JavaScript. That JavaScript makes
CRUD requests to relative URLs under `/api`. The Node.js backend validates HTTP
requests and performs SQL queries. PostgreSQL persists todos on a PVC. Database
credentials come from one Secret referenced by PostgreSQL and the backend.

Before these layers were added, Homework 3 served only fixed HTML. Static HTML
does not need an API or database because it stores no application data.

## The networking experiment's unchanged foundation

The Deployment always runs two replaceable Nginx Pods:

```text
Deployment/homework3-server
       |
       v
ReplicaSet
       |
       +--> Pod A: app=homework3-server, changing IP
       +--> Pod B: app=homework3-server, changing IP
```

Every frontend Service variant selects both Nginx Pods using:

```yaml
selector:
  app: homework3-server
```

Only the way clients reach that frontend Service changes. The backend and
PostgreSQL Services remain ClusterIP throughout the experiment.

## Part 1: ClusterIP

```text
Pod inside cluster
       |
       | homework3-server:8088
       v
ClusterIP Service
       |
       +--> server Pod A:80
       +--> server Pod B:80

Outside client ---X---> no external entry point
```

`ClusterIP` provides a stable virtual IP and DNS name reachable from the cluster
network. It is the correct default for services consumed by other workloads or
by an Ingress controller. It avoids opening an unnecessary external port.

## Part 2: NodePort

```text
Client
  |
  | any reachable NODE_IP:30088
  v
NodePort on every node
  |
  v
Service -> one ready server Pod
```

`NodePort` includes everything ClusterIP provides and additionally reserves a
port, normally in `30000-32767`, on every node. Clients must know a reachable
node address and port. It is rarely the final production interface because:

- clients must manage node addresses;
- ports are awkward and limited;
- it provides no HTTP host/path routing or TLS management;
- node/firewall exposure is easy to mismanage;
- cloud LoadBalancers and Ingress usually provide a better public interface.

NodePort is still useful for labs, debugging, bare-metal building blocks, and
software that deliberately places its own load balancer in front of node ports.

## Part 3: LoadBalancer

```text
External address
       |
       v
LoadBalancer Service
       |
       v
ClusterIP Service behavior -> server Pods
```

`LoadBalancer` asks the platform for an external load balancer. It normally
also builds on ClusterIP and NodePort behavior internally.

### In this local k3d cluster

k3s includes ServiceLB (formerly called Klipper LoadBalancer). It runs helper
Pods and uses addresses/ports belonging to the local Docker-based nodes. It
does not create an internet-facing appliance. Host access still depends on
which Docker ports k3d published.

### In a managed cloud

The cloud controller calls AWS, Azure, GCP, or another provider API to create a
real managed load balancer. The provider configures forwarding and health
checks and assigns a public or private IP/DNS address. This is convenient but
usually creates a billable cloud resource for each LoadBalancer Service.

## Part 4: Ingress and Layer 7

A plain LoadBalancer generally makes a Layer 4 decision using IP address and
TCP/UDP port. It does not need to understand that an HTTP request contains a
hostname, URL path, headers, or cookies.

An Ingress controller operates at Layer 7 for HTTP/HTTPS:

```text
One external Traefik entry point
                |
                | inspect HTTP host and path
                |
                +-- Host: homework3.local, Path: /
                |      -> homework3-server Service
                |
                +-- Host: shop.example.com, Path: /api
                |      -> shop-api Service
                |
                +-- Host: blog.example.com, Path: /
                       -> blog Service
```

Ingress benefits include:

- sharing one external load balancer across many applications;
- host-based routing (`api.example.com` versus `shop.example.com`);
- path-based routing (`/api` versus `/`);
- central TLS certificate termination;
- HTTP-to-HTTPS redirects;
- controller-dependent middleware such as authentication, rate limits,
  rewrites, retries, and header changes.

The Ingress object is only configuration. Traefik is the Ingress controller
that reads it and actually proxies traffic. The controller itself needs an
external entry point, commonly one LoadBalancer Service. Application Services
behind it can remain ClusterIP.

In the final manifest, host `homework3.local` has two path rules:

```text
/api/* -> homework3-backend:3000
/*     -> homework3-server:8088
```

The `/api` rule is more specific, so API traffic reaches Node.js while all other
paths reach Nginx. PostgreSQL has no Ingress rule at all.

## Why not one LoadBalancer per application?

It can work, especially for non-HTTP protocols or when isolation requires a
dedicated address. For many HTTP applications, however, one Ingress controller
can reuse one external load balancer and route by hostname/path. That reduces
cloud cost and centralizes HTTP policy.

## Understanding checklist

You understand this homework when you can explain:

1. Why all Service types still use selectors and stable Service networking.
2. Which clients can reach ClusterIP, NodePort, and LoadBalancer.
3. Why `localhost:30088` is not automatically available with k3d.
4. What a cloud creates for a LoadBalancer Service versus what k3s does locally.
5. What Layer 7 information Ingress can use that a basic Layer 4 load balancer
   cannot.
6. Why backend application Services commonly stay ClusterIP behind Ingress.
