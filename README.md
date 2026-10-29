# TETHERED

A two-player co-op space game in the browser. Two ships are joined by an energy tether, and anything you sweep the tether through *fast enough* gets sliced.

- **Fly:** WASD / arrow keys
- **Anchor:** Space / Shift. Your ship gets heavy and brakes hard, so your partner swings around you.
- **Slice:** Only works with momentum. If the tether moves too slowly, asteroids just bounce off it.
- **The tether snaps** under too much strain (for example when you both pull apart). Fly close together again to reconnect it.
- Quick slices in a row build up a combo multiplier.
- **Planets** pull in ships and asteroids, and the layout changes every wave. Fly fast through the golden ring around a planet to get a **slingshot boost**: higher top speed and double points for slices.
- **Drones** (from wave 2) keep their distance, dodge the tether and shoot at you — but the tether blocks their shots.
- **Space jellyfish** (from wave 3) drift towards you in pulses, split into three when sliced, and sting on contact.
- **Leviathan**, a space whale boss, shows up every 5 waves. It can't be sliced: press the **taut** tether into it to squeeze it, and orbit it together so the tether wraps around it. A full wrap (golden ring around the whale) stuns it and deals big damage. Watch out for its charge — it shivers and glows red before it dashes.
- **Highscores** are saved per browser; name your team after a good run.

You connect with a room code, peer-to-peer over WebRTC. It doesn't matter whether you're both on the same GitHub Pages URL or on two different ones.

---

## Getting started

You need Node.js 20 or newer.

```bash
npm install
npm run dev
```

Then open `http://localhost:5173`.

The menu, in-game text and code comments are all in English.

### Testing multiplayer locally

- **Without internet:** Open `http://localhost:5173/?local` in **two windows side by side** (not tabs). Choose "Create room" in one window and join with the code in the other. This uses a `BroadcastChannel` instead of WebRTC.
- **Real WebRTC:** Same thing without `?local`, but it goes through the public PeerJS server. This is also how you play over the internet.
- **On your phone:** open the site in landscape. Drag on the left half of the screen to fly (floating joystick), hold the ⚓ button on the right to anchor. Fullscreen and landscape lock kick in automatically when you create or join a room (not supported on iOS Safari).
- **Two players on one keyboard:** Choose "Local co-op" in the menu (P1: WASD + Space, P2: arrows + Enter).

In dev mode, the scene is available in the browser console as `__tethered.scene`.

---

## Setting up GitHub Pages

The feature is called **GitHub Pages**. The URL is always `https://<user-or-org>.github.io/<repo-name>/`.

1. Create a repo and push the code (branch `main` or `master`).
2. In the repo, go to **Settings → Pages → Build and deployment → Source** and select **"GitHub Actions"**.
3. That's it. Every push to `main` or `master` runs `.github/workflows/deploy.yml`, which builds and publishes the game. You'll find the link in the **Actions** tab for each run.

### Two URLs, one game

Recommended setup:

- **One main repo** (for example in a small GitHub organization, or under one of your accounts) with both of you as collaborators. Its Pages URL is the "official" version.
- **Each of you has a fork** on your own account, which gives you your own URL, e.g. `elias.github.io/tethered`. In the fork, **enable Actions** once (Actions tab → "I understand…") and set Pages to "GitHub Actions" as above.
- Build new features in your fork or a branch, test them on your own URL, then merge into the main repo via pull request.

**Important:** To play together, both sides must run the same `PROTOCOL_VERSION` (`src/sim/constants.ts`). Bump the version whenever messages or snapshots change. Anyone on a different version gets a clear error message when joining. The version is shown in the bottom-left corner of the game.

---

## Project structure

```
src/
  main.ts              Entry point: starts Phaser, menu/lobby (DOM overlay)
  session.ts           Glues simulation and networking together (local / host / client)
  highscores.ts        Highscore list (localStorage)
  sim/
    constants.ts       ALL tuning values (tether, ships, enemies, boss, planet layouts …) — this is where the game feel lives
    types.ts           Data types of the world (ships, asteroids, enemies, boss, events)
    sim.ts             Main game loop: waves, tether, slicing, gravity, collisions
    physics.ts         Pure physics helpers shared by the host and client-side prediction
    core.ts            Small helpers (random numbers, scoring, damage, tether contact)
    enemies.ts         Drones, jellyfish, bullets
    boss.ts            Leviathan: movement, charge attack, squeeze + wrap mechanic
    snapshot.ts        Network format + interpolation on the client
  net/
    protocol.ts        Message types, room codes
    net.ts             PeerJS (WebRTC) and BroadcastChannel (dev), handshake with version check
    predict.ts         Client-side prediction for your own ship
  scenes/GameScene.ts  Rendering: stars, tether, asteroids, ships, particles, HUD, screen shake
  render/entities.ts   Rendering of drones, jellyfish, bullets and the whale
  render/textures.ts   All graphics generated procedurally via canvas (ships, asteroids, planets, nebula)
  render/sfx.ts        Sound effects as a WebAudio synth (no assets)
```

### Netcode in one paragraph

The **host is authoritative**: only the host runs `sim.ts`, at a fixed 60 Hz timestep. It sends a compact snapshot to the client 30 times per second. The client only sends its inputs (direction + anchor) and renders the snapshots with about 80 ms of delay, interpolating between two known states. It's simple, robust, and plenty for a co-op game. Because the renderer only receives a `ViewState`, it doesn't know whether it's the host or the client.

**Client-side prediction:** so your own ship reacts instantly even with ping, the client sends its input every tick with a sequence number and simulates its own ship locally with the same physics code (`sim/physics.ts`). Each snapshot tells the client which input the host has applied last (`ack`); the client resets its ship to the host's state and replays all newer inputs. Remaining differences (e.g. from collisions only the host knows about) fade out smoothly instead of snapping. The other player's ship and everything else stay interpolated.

### Adding a new mechanic

1. Add the state to `World` (`sim.ts`) and update it in `step()`.
2. If the client needs to see it: add a field to `Snapshot`/`ViewState` (`snapshot.ts`) and **bump `PROTOCOL_VERSION`**.
3. For one-off effects (explosion, sound), push a `SimEvent`. It automatically reaches both players.
4. Draw it in `GameScene.ts`, or react to the event in `handleEvent`.

---

## Ideas for next steps

- [x] **Gravity:** planets with a slingshot boost
- [ ] **Black hole** that pulls you apart, and moving planet layouts (moons in orbit)
- [ ] **Scrap + upgrades** between waves: longer or electric tether, magnet, shield
- [x] **Enemy types:** drones that avoid the tether, space jellyfish that split
- [x] **Boss:** a space whale you have to "wrap up" with the tether
- [x] **Client-side prediction** for your own ship
- [ ] **Gamepad support** (Phaser has `this.input.gamepad`)
- [ ] **Touch controls** for phones
- [x] **Highscore list** (per browser)
- [ ] **Online highscore list** shared by everyone (e.g. Supabase or Firebase)

## Performance

Rendering is the bottleneck, not game logic (the simulation handles ~20 objects and takes well under 1 ms per frame), so WebAssembly wouldn't help. Instead there are graphics quality levels:

| Level | What's on |
|---|---|
| High | everything, incl. bloom (the most expensive effect by far) |
| Medium | no bloom; parallax stars, dust, planet gravity ripples |
| Low | no bloom, no extra background/planet effects, fewer particles, simpler tether |

- The **"Graphics"** button at the bottom cycles Auto → High → Medium → Low (saved per browser).
- **Auto** starts at High on desktop and Medium on phones, and steps down automatically if the frame rate stays below 45 FPS.
- Force a level via URL: `?quality=low`. Show an FPS counter with **F** / **F3** or `?debug`.
- The static background (nebula, stars, arena border) and the vignette are CSS behind/over the transparent canvas, so the GPU doesn't redraw them every frame.

## Known limitations

- On some networks (mobile data, university or corporate Wi-Fi), a direct WebRTC connection won't work. You'll need a TURN server then, e.g. the free tier from metered.ca. Add it in `net.ts` via `new Peer(…, { config: { iceServers: […] } })`.
- If the host minimizes or switches away from the tab, the browser pauses the game, which pauses it for both players.
- The public PeerJS server is free but comes with no guarantees. If it ever goes down, you can host your own `peerjs-server`.
