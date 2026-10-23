# CompNet Chat App

Computer Networks term project (socket programming): a multi-user Chat App with Private Rooms and Groups, built with NestJS, React and Socket.IO over WebSocket only.

## Running it

Needs Node 22 or later. Three npm workspaces: `server` (NestJS), `client` (React + Vite) and `shared` (the socket event names and payload types both use).

```bash
npm install
```

Copy `server/.env.example` to `server/.env` and put the MongoDB connection string in it. Never commit `.env`.

**Development**, in two terminals: `npm run dev -w server`, then `npm run dev -w client` and open the address Vite prints. Vite forwards the socket connection to the server.

**Demo or another laptop**: `npm run build`, then `npm start`. The server serves the page and the socket connection on one port (3000, or `PORT`). Other laptops on the same network open `http://<this laptop's IP>:3000`.

**Checks**: `npm run lint`, `npm run build` and `npm test`, the same as CI. The server's tests boot the whole app against an in-memory MongoDB and connect real Clients; `server/test/app.ts` has the `connectAsUser` helper to reuse.

## Where decisions live

- [GLOSSARY.md](GLOSSARY.md): the words we use. Use these names in code, issues and prompts.
- [docs/adr/](docs/adr/): decisions that must not be quietly undone.
- [GitHub Issues](../../issues): the spec and the tickets. Each ticket is meant to be enough on its own to start work.

## Working with an AI

Whichever AI you use, the code passes the same gate: a pull request that passes CI and gets one teammate's approval.

**Claude Code** reads `CLAUDE.md`, `GLOSSARY.md` and `docs/` by itself, and can read issues with `gh`. Point it at the ticket: "implement issue #N".

**A chat AI** (ChatGPT, Claude.ai, Gemini, ...) can't see the repo, so you give it the context:

1. Once: create a Project in your chat app and upload `GLOSSARY.md`, every file in `docs/adr/`, and the spec issue. Re-upload when they change, and add the shared event types once the `shared/` folder exists.
2. Per ticket: paste the ticket's body and the files you're changing.
3. Don't accept code that renames glossary terms or contradicts an ADR; tell the AI to fix it.

**Both:** paste the prompt you used into the PR description. The slides need it.

## Workflow

- One branch and one pull request per ticket. `main` only changes through pull requests.
- CI must pass and a teammate must approve before merging.
- Review across tools when you can: a Claude Code user reviews a chat-AI user's PR, and the other way round.
- Merging to `main` deploys to Render once the cloud-hosting ticket sets it up.
