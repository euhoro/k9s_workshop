const list = document.querySelector("#todos");
const form = document.querySelector("#todo-form");
const input = document.querySelector("#todo-text");
const message = document.querySelector("#message");
const apiPrefix = window.APP_CONFIG?.apiPrefix || "/api";

async function request(path, options) {
  const response = await fetch(`${apiPrefix}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  return response.status === 204 ? null : response.json();
}

function render(todos) {
  list.replaceChildren(...todos.map((todo) => {
    const item = document.createElement("li");
    item.className = todo.completed ? "completed" : "";

    const toggle = document.createElement("button");
    toggle.className = "toggle";
    toggle.textContent = todo.completed ? "✓" : "○";
    toggle.onclick = async () => { await request(`/todos/${todo.id}`, { method: "PATCH" }); await load(); };

    const text = document.createElement("span");
    text.textContent = todo.text;

    const remove = document.createElement("button");
    remove.className = "remove";
    remove.textContent = "Delete";
    remove.onclick = async () => { await request(`/todos/${todo.id}`, { method: "DELETE" }); await load(); };

    item.append(toggle, text, remove);
    return item;
  }));
}

async function load() {
  try {
    render(await request("/todos"));
    message.textContent = "";
  } catch (error) {
    message.textContent = "Could not reach the backend.";
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  await request("/todos", { method: "POST", body: JSON.stringify({ text: input.value }) });
  input.value = "";
  await load();
});

load();
