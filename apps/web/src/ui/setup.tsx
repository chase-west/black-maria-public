import { useAuth } from "../auth.js";

/**
 * How a candidate gets the client and the simulator and points them at this server (SPEC 6, 8.5). Every command the
 * portal shows comes from here, filled in with this server's address and the candidate's own token, so it works when
 * pasted as it is.
 */
export interface Setup {
  server: string;
  token: string;
  /** One command that installs both packages, or null when this server has none to offer. */
  install: string | null;
  /** The public repository: a git URL or a tarball on this server, or null. */
  repo: string | null;
}

export function useSetup(): Setup | null {
  const auth = useAuth();
  if (auth.status !== "ok") return null;
  const server = auth.me.get?.server ?? window.location.origin;
  return { server, token: auth.me.token, install: auth.me.get?.install ?? null, repo: auth.me.get?.repo ?? null };
}

/** A client command for this server and this token, ready to paste. */
export function clientCommand(s: Setup | null, args: string): string {
  return s ? `npx blackmaria ${args} --server ${s.server} --token ${s.token}` : `npx blackmaria ${args}`;
}

/** The `.env` that makes every bare `npx blackmaria ...` play this server instead of a local simulator. */
export function EnvBlock(props: { setup: Setup | null }) {
  if (!props.setup) return null;
  return <pre className="cmd mono">{`BM_SERVER=${props.setup.server}\nBM_TOKEN=${props.setup.token}`}</pre>;
}

/** The way in: write the bot file, edit it, play it with the trace on. */
export function FixIt(props: { setup: Setup | null }) {
  return (
    <div className="fix-it">
      <h3>Fix it</h3>
      <pre className="cmd mono">{`npx blackmaria init\n# edit my_bot.ts, the file it wrote\n${clientCommand(props.setup, "play --vs master --bot my_bot.ts --trace")}`}</pre>
    </div>
  );
}

/** Where the code comes from: the install line and `init`, and the repository link. */
export function GetTheCode(props: { setup: Setup | null }) {
  const s = props.setup;
  return (
    <>
      <p>In an empty directory, install the client and the simulator, then write the file you edit:</p>
      <pre className="cmd mono">{`${s?.install ?? "npm install @black-maria/sim blackmaria"}\nnpx blackmaria init`}</pre>
      {s?.repo ? (
        <p className="small">
          All the source, server and Maria included, is in the public repo:{" "}
          <a href={s.repo} className="mono">
            {s.repo.split("/").pop()}
          </a>
          . Its README covers building it and running the same commands from source.
        </p>
      ) : null}
    </>
  );
}
