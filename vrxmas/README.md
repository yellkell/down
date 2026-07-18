# Christmas Sled VR (Browser WebXR)

A tiny **browser-based sledding experience** (HTML/CSS/JS) with **VR support** using WebXR + Three.js.

## Run it

WebXR features typically require **HTTPS or localhost**. Use any local static server.

### Option A: Python (if installed)

```bash
python -m http.server 5173
```

Then open `http://localhost:5173`.

### Option B: Node (if installed)

```bash
npx --yes serve . -l 5173
```

Then open `http://localhost:5173`.

## VR-only / Roomscale

This is a **roomscale VR** experience (not a desktop-playable game).

- You stand on a **2m × 2m** sled platform (in VR).
- **Move in real life** to different tiles (now **6 tiles**) to dodge targeted impacts.
- Press **Trigger** (or **Grip**) to **recenter** the platform under you.

## Notes

- The mountain/snow is **procedural** (no external assets required).
- Obstacles include **rocks/logs/ice chunks** (telegraphed in **red**).
- Special items are telegraphed in **green** (heal/shield/boost).
- Hazard telegraphs are constrained so there are **always 2 connected free tiles** available (you may have to dart to them).
- If you reach the end or lose all health, it resets you to the top.


