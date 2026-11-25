import { render } from "preact";
import { useMemo } from "preact/hooks";
import { Api } from "./api";
import { AdminPage } from "./Admin";
import { GamePage } from "./Game";
import { HomePage } from "./Home";
import { registerServiceWorker } from "./push";
import "./styles.css";

function App() {
  const path = location.pathname;
  const m = /^\/p\/([\w-]+)(?:\/g\/([\w-]+))?\/?$/.exec(path);
  const token = m?.[1];
  const api = useMemo(() => (token ? new Api(token) : null), [token]);

  if (path.startsWith("/admin")) return <AdminPage />;
  if (api && token && m?.[2]) return <GamePage api={api} token={token} gameId={m[2]} />;
  if (api && token) return <HomePage api={api} token={token} />;
  return (
    <div class="page">
      <h1 class="title">Sarathys' Word Battles</h1>
      <p>This is a private family word game. Open the personal link you were sent to play.</p>
    </div>
  );
}

registerServiceWorker();
render(<App />, document.getElementById("app")!);
