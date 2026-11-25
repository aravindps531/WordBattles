import { render } from "preact";
import { useMemo } from "preact/hooks";
import { Api } from "./api";
import { AdminPage } from "./Admin";
import { ChessPage } from "./Chess";
import { GamePage } from "./Game";
import { GoPage } from "./GoGame";
import { SeaPage } from "./SeaGame";
import { HomePage } from "./Home";
import { registerServiceWorker } from "./push";
import "./styles.css";

function App() {
  const path = location.pathname;
  const m = /^\/p\/([\w-]+)(?:\/(g|c|go|sea)\/([\w-]+))?\/?$/.exec(path);
  const token = m?.[1];
  const api = useMemo(() => (token ? new Api(token) : null), [token]);

  if (path.startsWith("/admin")) return <AdminPage />;
  if (api && token && m?.[2] === "c") return <ChessPage api={api} token={token} gameId={m[3]} />;
  if (api && token && m?.[2] === "sea") return <SeaPage api={api} token={token} gameId={m[3]} />;
  if (api && token && m?.[2] === "go") return <GoPage api={api} token={token} gameId={m[3]} />;
  if (api && token && m?.[2] === "g") return <GamePage api={api} token={token} gameId={m[3]} />;
  if (api && token) return <HomePage api={api} token={token} />;
  return (
    <div class="page">
      <h1 class="title">Sarathys' Game Room</h1>
      <p>This is a private family games site. Open the personal link you were sent to play.</p>
    </div>
  );
}

registerServiceWorker();
render(<App />, document.getElementById("app")!);
