// Because both routes share one origin, this is a path prefix rather than a
// separate backend host. It must match the backend path in the Ingress.
window.APP_CONFIG = {
  apiPrefix: "/api",
};
