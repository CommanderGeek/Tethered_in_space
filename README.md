# TETHERED

Koop-Weltraumspiel für zwei im Browser. Zwei Schiffe hängen an einem Energieseil, und alles, was ihr *schnell genug* mit dem Seil durchzieht, wird zerschnitten.

- **Fliegen:** WASD / Pfeiltasten
- **Ankern:** Leertaste / Shift. Du wirst schwer und bremst, dein Partner schwingt um dich herum.
- **Schneiden:** Nur mit Schwung. Zu langsam prallen Asteroiden einfach ab.
- **Seil reißt** bei zu viel Zug (z. B. wenn beide auseinanderziehen). Fliegt wieder nah zusammen, dann verbindet es sich neu.
- Schnelle Schnitte hintereinander geben Kombo-Punkte.
- **Planeten** ziehen Schiffe und Asteroiden an und wechseln mit jeder Welle. Fliegt ihr schnell durch den goldenen Ring um einen Planeten, bekommt ihr einen **Slingshot-Boost**: mehr Höchstgeschwindigkeit und doppelte Punkte für Schnitte.

Gespielt wird über einen Raumcode, Peer-to-Peer per WebRTC. Es ist egal, ob ihr auf derselben oder auf zwei verschiedenen GitHub-Pages-URLs seid.

---

## Loslegen

Ihr braucht Node.js ab Version 20.

```bash
npm install
npm run dev
```

Danach `http://localhost:5173` öffnen.

### Multiplayer lokal testen

- **Ohne Internet:** `http://localhost:5173/?local` in **zwei nebeneinanderliegenden Fenstern** öffnen (nicht als Tabs). Dann im einen Fenster „Raum erstellen“ wählen und im anderen mit dem Code beitreten. Das läuft über einen `BroadcastChannel` statt WebRTC.
- **Echt über WebRTC:** Ohne `?local` geht es genauso, nur über den öffentlichen PeerJS-Server. So spielt man auch über das Internet.
- **Lokal zu zweit an einer Tastatur:** Im Menü „Lokal zu zweit“ wählen (P1: WASD + Leertaste, P2: Pfeile + Enter).

Im Dev-Modus ist die Szene in der Browser-Konsole unter `__tethered.scene` erreichbar.

---

## GitHub Pages einrichten

Das Feature heißt **GitHub Pages**. Die URL ist immer `https://<user-oder-org>.github.io/<repo-name>/`.

1. Repo anlegen und den Code pushen (Branch `main`).
2. Im Repo **Settings → Pages → Build and deployment → Source: „GitHub Actions“** einstellen.
3. Fertig. Bei jedem Push auf `main` baut `.github/workflows/deploy.yml` das Spiel und veröffentlicht es. Den Link findet ihr im Tab **Actions** beim jeweiligen Lauf.

### Zwei URLs, ein Spiel

Empfohlenes Setup:

- **Haupt-Repo** (z. B. in einer kleinen GitHub-Organisation oder bei einem von euch), beide als Collaborators. Die Pages-URL davon ist die „offizielle“ Version.
- **Jeder hat einen Fork** auf dem eigenen Account und damit eine eigene URL, z. B. `elias.github.io/tethered`. Im Fork einmalig **Actions aktivieren** (Tab Actions → „I understand…“) und Pages wie oben auf „GitHub Actions“ stellen.
- Neue Features baut ihr im Fork oder in einem Branch, testet sie auf eurer eigenen URL und mergt dann per Pull Request ins Haupt-Repo.

**Wichtig:** Damit ihr zusammen spielen könnt, muss auf beiden Seiten dieselbe `PROTOCOL_VERSION` laufen (`src/sim/constants.ts`). Zählt die Version hoch, sobald sich Nachrichten oder Snapshots ändern. Wer eine andere Version hat, bekommt beim Beitreten eine klare Fehlermeldung. Die Version steht unten links im Spiel.

---

## Aufbau

```
src/
  main.ts              Einstieg: Phaser starten, Menü/Lobby (DOM-Overlay)
  session.ts           Klebt Simulation + Netzwerk zusammen (local / host / client)
  sim/
    constants.ts       ALLE Tuning-Werte (Seil, Schiffe, Wellen, Planeten-Layouts …), hier wird das Spielgefühl eingestellt
    sim.ts             Reine Spiellogik ohne Phaser: Physik, Seil, Schneiden, Wellen, Gravitation
    snapshot.ts        Netzwerkformat + Interpolation auf dem Client
  net/
    protocol.ts        Nachrichtentypen, Raumcodes
    net.ts             PeerJS (WebRTC) und BroadcastChannel (Dev), Handshake mit Versionscheck
  scenes/GameScene.ts  Rendering: Sterne, Seil, Asteroiden, Partikel, HUD, Screenshake
  render/textures.ts   Alle Grafiken prozedural per Canvas (Schiffe, Asteroiden, Planeten, Nebel)
  render/sfx.ts        Soundeffekte als WebAudio-Synth (keine Assets)
```

### Netcode in einem Absatz

Der **Host ist autoritativ**: Nur er führt `sim.ts` aus, mit festem Zeitschritt bei 60 Hz. Er schickt 30-mal pro Sekunde einen kompakten Snapshot an den Client. Der Client schickt nur seine Eingaben (Richtung + Anker) und rendert die Snapshots mit etwa 80 ms Verzögerung, interpoliert zwischen zwei bekannten Zuständen. Das ist simpel und robust und für Koop völlig ausreichend. Weil der Renderer nur einen `ViewState` bekommt, weiß er nicht, ob er Host oder Client ist.

### Eine neue Mechanik einbauen

1. Den Zustand in `World` ergänzen (`sim.ts`) und in `step()` updaten.
2. Wenn der Client es sehen muss: Feld zu `Snapshot`/`ViewState` hinzufügen (`snapshot.ts`) und **`PROTOCOL_VERSION` hochzählen**.
3. Für einmalige Effekte (Explosion, Sound) ein `SimEvent` pushen. Das kommt automatisch bei beiden an.
4. In `GameScene.ts` zeichnen bzw. in `handleEvent` auf das Event reagieren.

---

## Ideen für die nächsten Schritte

- [x] **Gravitation:** Planeten mit Slingshot-Boost
- [ ] **Schwarzes Loch**, das euch auseinanderzieht, und Planetenlayouts, die sich bewegen (Monde im Orbit)
- [ ] **Schrott + Upgrades** zwischen den Wellen: längeres oder elektrisches Seil, Magnet, Schild
- [ ] **Gegnertypen:** Drohnen, die das Seil meiden, Weltraumquallen, die sich teilen
- [ ] **Boss:** ein Weltraumwal, den man mit dem Seil „einwickeln“ muss
- [ ] **Client-Prediction** fürs eigene Schiff, damit es sich bei hohem Ping direkter anfühlt
- [ ] **Gamepad-Support** (Phaser hat `this.input.gamepad`)
- [ ] **Touch-Steuerung** fürs Handy
- [ ] **Highscore-Liste** (z. B. Supabase oder Firebase)

## Bekannte Grenzen

- In manchen Netzen (Mobilfunk, Uni- oder Firmen-WLAN) klappt die direkte WebRTC-Verbindung nicht. Dann braucht es einen TURN-Server, z. B. den kostenlosen Tier von metered.ca. Den trägt man in `net.ts` bei `new Peer(…, { config: { iceServers: […] } })` ein.
- Wenn der Host den Tab minimiert oder wechselt, pausiert der Browser das Spiel, und damit pausiert es für beide.
- Der öffentliche PeerJS-Server ist kostenlos, aber ohne Garantie. Falls er mal ausfällt, kann man einen eigenen `peerjs-server` hosten.
