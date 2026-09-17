# 2D Space Shooter — Design & Implementation Plan

> Single HTML file. Vanilla JS + Canvas 2D. No build step.

---

## 1. System Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     game.js (entry point)               │
│  ┌──────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ GameLoop  │  │ EntityManager│  │   InputManager   │  │
│  │ (request  │  │  (unified    │  │   (keyboard +    │  │
│  │  animFrame│  │   registry)  │  │    mouse +       │  │
│  │  loop)    │  │              │  │    touch)        │  │
│  └────┬──────┘  └──────┬───────┘  └────────┬─────────┘  │
│       │                │                    │            │
│  ┌────▼────────────────▼────────────────────▼─────────┐  │
│  │                    World (spatial grid)            │  │
│  │  ┌────────┐ ┌──────────┐ ┌──────────┐ ┌────────┐  │  │
│  │  │Player  │ │  Enemy   │ │ Projectile││ Pickup │  │  │
│  │  │  Ship  │ │  Entities│ │  Entities ││ Entities│  │  │
│  │  └────────┘ └──────────┘ └──────────┘ └────────┘  │  │
│  │  ┌──────────────────────────────────────────────┐  │  │
│  │  │          Obstacles (Asteroids/Walls)          │  │  │
│  │  └──────────────────────────────────────────────┘  │  │
│  └──────────────────────────┬─────────────────────────┘  │
│                             │                            │
│  ┌──────────────────────────▼─────────────────────────┐  │
│  │           Upgrade / Ability System (see §2)        │  │
│  └────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────┬─────────────────────────┐  │
│  │     Rendering Pipeline   │   Audio (optional)      │  │
│  │  (camera transforms,    │   (Web Audio API)       │  │
│  │   layer batching)       │                         │  │
│  └──────────────────────────┴─────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### Core Modules

| Module | Responsibility |
|---|---|
| **Game** | Lifecycle, delta-time loop, state machine (menu → playing → game over) |
| **EntityManager** | Add/remove/query entities by type, spatial hashing for collision broad-phase |
| **InputManager** | Normalized input (WASD → vector2, mouse → world-angle, touch joystick) |
| **World** | Static obstacle map, boundaries, spatial grid |
| **Camera** | Follows player with configurable offset, smoothing, screen bounds |
| **Physics** | Velocity, friction, acceleration, circle-rect & circle-circle collision |
| **Spawner** | Wave logic, difficulty curve, enemy/pickup/obstacle spawning |
| **Renderer** | Canvas drawing, camera matrix, sprites/particles |
| **UpgradeSystem** | Composable ability graph (see §2) |
| **AudioManager** | (Future) procedural SFX via Web Audio |

### Entity Base (all inherit from this)

```js
class Entity {
  id, x, y, vx, vy, radius, type, active
  update(dt) {}     // called every frame
  draw(ctx, cam) {} // called every frame
  onCollision(other) {}
}
```

---

## 2. Upgrade System Design — Composable & Extensible

### Core Principle

> **Upgrades are *modifiers* that compose onto a `Weapon` object.**  
> A weapon starts with a base behavior. Each upgrade adds a *behavior layer* — they stack without replacing each other.

### Data Model

```
Player
 └── weapons[]       (list, supports multi-slot)
      └── baseType: "laser" | "missile" | "blaster"
      └── upgrades: [UpgradeRef, ...]   (stackable, order matters)
```

Each `UpgradeRef` = `{ id, level, duration? }`

### Upgrade Interface

```js
class Upgrade {
  id              // unique slug
  name            // display name
  description     // tooltip
  icon            // emoji or sprite
  stackable       // can have multiple levels?
  
  // Called when attached to a weapon — returns modifier functions
  apply(weapon) {
    return {
      onCreate(projectile) { /* mutate projectile properties */ },
      onUpdate(projectile, dt) { /* modify behavior each frame */ },
      onFire(player, weapon) { /* custom fire logic, e.g. spread */ },
      draw(projectile, ctx) { /* custom render override */ }
    }
  }
}
```

### Composition Example

```js
// Base weapon: straight laser, 1 bullet/frame
const laser = new Weapon('laser', { damage: 10, speed: 400, rate: 0.15 })

// Add upgrades (composable layers)
laser.add(new MultiShot({ count: 3, spread: 0.2 }))
laser.add(new CurveBullets({ radius: 150, direction: 1 }))
laser.add(new Piercing({ levels: 3 }))
laser.add(new Homing({ strength: 50 }))

// Execution order during fire:
// 1. Weapon.onFire() → calls each upgrade.onFire() in order
// 2. Weapon creates projectiles
// 3. Each projectile runs upgrade.onCreate(projectile)
// 4. Each frame: upgrade.onUpdate(projectile, dt) in order
// 5. Rendering: upgrade.draw() if provided, else default
```

### Upgrade Registry (for easy extension)

```js
const UPGRADE_REGISTRY = {
  'multishot': MultiShot,
  'curve': CurveBullets,
  'pierce': Piercing,
  'homing': Homing,
  'rapidfire': RapidFire,
  'spread': SpreadShot,
  'explosion': ExplosionOnDeath,
  // ... add new ones here, no code changes elsewhere
}
```

### Pickups & Upgrade Distribution

| Pickup ID | Effect |
|---|---|
| `health` | Restore HP |
| `upgrade_random` | Give player a random upgrade from `UPGRADE_REGISTRY` |
| `upgrade_[id]` | Give specific upgrade |
| `weapon_swap` | Swap base weapon type |
| `shield` | Temporary damage immunity |

Pickups drop as entities with a `dropType` field. Player pickup collects and triggers `Game.applyPickup(dropType)`.

### Why This Is Composable

1. **Order-independent** — each upgrade mutates the projectile independently; chaining is explicit.
2. **Additive** — `MultiShot` + `Curve` = 3 curved bullets, not a replacement.
3. **Zero-cost** — upgrades with no `onUpdate`/`draw` hooks have negligible overhead.
4. **Extensible** — new upgrade = new class + one registry entry. No switch/if chains.
5. **Time-limited upgrades** — `duration` field + timer in `Weapon` for power-up style effects.

---

## 3. Step-by-Step Implementation Plan (7 Steps)

### Step 1 — Foundation: Game Loop, Input, Camera, Player Ship ✅ DONE
**Goal:** A ship that responds to WASD (with inertia), mouse aiming, and touches. Camera follows smoothly.
> **Implemented** in `space_shooter.html` — Game loop with fixed dt, InputManager (WASD + mouse + touch joystick), Player with thrust/friction physics, Camera with smooth follow + clamping, Renderer with camera transform, 2000×2000 world arena, mobile detection.

| What | Details |
|---|---|
| `Game` class | `requestAnimationFrame` loop, fixed `dt = 1/60`, delta accumulation |
| `InputManager` | Key state map (keydown/keyup), mouse position → screen, touch joystick (virtual D-pad + aim) |
| `Player` entity | Position, velocity, rotation toward mouse, thrust + friction physics |
| `Camera` | `x, y` target → lerps to player position, clamps to world bounds |
| `Renderer` | Clear canvas, apply camera transform (`ctx.translate`, `ctx.rotate`), draw player ship (simple polygon) |
| `World` | Fixed-size arena (e.g. 2000×2000), visible area = viewport |
| Mobile detection | Touch events → virtual joystick rects |

**Deliverable:** Player ship moves with WASD (momentum-based), rotates to mouse, camera follows. Works on mobile with touch.

---

### Step 2 — Projectile System & Firing ✅ DONE
**Goal:** Player fires bullets toward crosshair. Basic collision detection.
> **Implemented** in `space_shooter.html` — Projectile entity with pooling, Weapon base class with cooldown & upgrade slots, click-to-fire with crosshair, Physics module with circle-circle collision, EntityManager with object pool and type queries.

| What | Details |
|---|---|
| `Projectile` entity | Position, velocity, damage, lifetime, owner (player vs enemy) |
| `Weapon` base class | `fire(player)`, cooldown timer, projectile creation |
| Firing logic | Mouse click / auto-fire, crosshair drawn at mouse position |
| `Physics` module | Circle-circle collision: `dist(a.pos, b.pos) < a.radius + b.radius` |
| `EntityManager` | Pool-based spawn/recycle. Query: `getAllOfType('projectile')` |

**Deliverable:** Player shoots bullets that travel toward crosshair. Bullets are recycled (object pool).

---

### Step 3 — Enemies, Spawning & AI ✅ DONE
**Goal:** Enemies spawn off-screen and move toward the player.
> **Implemented** in `space_shooter.html` — Enemy entity (chaser + shooter types), Spawner module with wave logic and difficulty scaling, enemy AI (chasers rush, shooters maintain distance and fire back), full collision pipeline (projectiles ↔ enemies, enemy bullets ↔ player, contact damage ↔ player), game over state with restart, screen shake on hits, minimap with enemy dots, wave/enemy-count HUD, HP bar color transitions.

| What | Details |
|---|---|
| `Enemy` entity | HP, speed, damage, radius, type (`chaser` / `shooter`), hit flash, HP bars |
| `Spawner` module | Off-screen spawn positions, wave timer, difficulty curve (HP/speed scaling per wave), staggered spawns |
| Enemy AI | Chasers: direct rush toward player. Shooters: circle-strafe at mid-range, fire projectiles back. |
| Enemy projectiles | Same `Projectile` system, owner tag `'enemy'`, 250 px/s speed |
| Collision | Projectile vs Enemy (damage, destroy), Enemy bullets vs Player (damage + shake), Enemy contact vs Player (half damage + knockback) |
| Game states | `playing` → `game_over` transition, restart via SPACE / click, shake cleared on game over |
| HUD | Wave counter, enemy remaining count, HP bar (color: green/yellow/red), score, minimap (player + enemy dots) |

**Deliverable:** Enemies spawn in waves with increasing difficulty, chase or shoot the player, deal contact and bullet damage, player dies at 0 HP and can restart.

---

### Step 4 — Obstacles (Asteroids/Walls) & Spatial Hashing ✅ DONE
**Goal:** Static obstacles that block ships, enemies, and projectiles.
> **Implemented** in `space_shooter.html` — `SpatialGrid` with 100px cells for O(1) broad-phase, `Obstacle` entity (circle asteroids + rectangle walls), `WorldGenerator` with procedural placement avoiding spawn area, full collision pipeline (player/enemy bounce+slide, projectiles destroyed on impact), proper axis-aligned resolution for walls, minimap obstacle rendering.

| What | Details |
|---|---|
| `SpatialGrid` | Hash grid (100×100 cells). `insert()`, `queryCircle()`, `queryRect()`, `build()` — O(1) broad-phase vs O(n²) brute force |
| `Obstacle` entity | Circle (irregular asteroids with craters, radial gradient) or Rect (metallic walls with detail lines). `_circleCollide`, `_circleRectCollide` (rotated), `_resolveCircleCollision`, `_resolveRectCollision` — per-face overlap for axis-aligned push |
| `WorldGenerator` | Places 15 asteroids + 6 walls with 50-attempt retry, keeps obstacles 30-40px apart, avoids center spawn zone |
| Collision resolution | Player/Enemy: push out + velocity bounce with 0.4 damping, perpendicular to hit face. Projectiles: destroyed on impact |
| World generation | Procedural — asteroids (12-point irregular polygons), walls (60px thick, 100-250px long), rotationally varied |
| Minimap | Obstacles shown as gray squares scaled by map ratio |

**Deliverable:** Obstacles visible on map. Ships and bullets collide with them. Performance via spatial grid. Walls resolve axis-aligned (no diagonal push bug).

---

### Step 5 — Pickups & Health System
**Goal:** Enemies drop health and upgrade pickups when destroyed.

| What | Details |
|---|---|
| `Pickup` entity | Type, position, lifetime (despawn timer), glow animation |
| Drop logic | `enemy.onDeath() → spawnPickup(enemy.pos)` |
| Player pickups | Circle overlap check, apply effect |
| Health/HP system | Player HP bar, death condition, respawn / game over |
| Pickup types | `health`, `upgrade_random` (placeholder for now) |

**Deliverable:** Enemies explode, drop pickups. Player collects health/upgrade pickups. HP bar UI.

---

### Step 6 — Composable Upgrade System
**Goal:** Implement the full upgrade architecture from §2.

| What | Details |
|---|---|
| `Upgrade` base class + interface | As specified in §2 |
| `Weapon` upgrade slots | `addUpgrade()`, `removeUpgrade()`, composition chain |
| Built-in upgrades | `MultiShot`, `CurveBullets`, `Piercing` (3 to start) |
| `UPGRADE_REGISTRY` | Central map for spawn-from-pickup |
| Pickup integration | `applyPickup('upgrade_random')` picks from registry |
| Time-limited upgrades | Duration tracking, auto-remove |

**Deliverable:** Player can collect upgrades that stack compositely on weapons.

---

### Step 7 — Polish & Meta-Game
**Goal:** Visual polish, audio, UI, difficulty scaling, restart.

| What | Details |
|---|---|
| Particles | Death explosions, engine thrust trails, pickup glow |
| Visual effects | ~~Screen shake on hit~~, ~~damage flash~~, ~~game over / restart~~, ~~minimap~~, ~~wave HUD~~, weapon-specific bullet effects |
| UI | ~~Score~~, ~~HP bar~~, weapon indicator, upgrade inventory panel |
| Waves / Difficulty | ~~Progressive enemy count~~, ~~speed~~, ~~HP scaling~~ |
| Game states | ~~Playing~~ → ~~Game Over~~ → Restart |
| Audio | Web Audio API: shoot, hit, explosion, pickup SFX (procedural) |
| Performance | ~~Object pooling~~, batch rendering, `will-change` optimization |

> **Partially done in Step 3:** screen shake, damage flash, game over state, restart, wave system, HUD, minimap.
> **Remaining:** particles (explosions, trails), audio, upgrade inventory panel, weapon-specific bullet effects.

**Deliverable:** Complete, polished game loop. Restartable. Good UX.

---

## File Structure (single file, but organized internally)

```
space_shooter.html
├── [CSS] styles (full-screen canvas, UI overlays)
├── [JS] — all in one <script> with IIFE or module pattern
│   ├── constants.js        (canvas size, physics params, colors)
│   ├── math.js             (vec2 utilities, collision helpers)
│   ├── input.js            (Keyboard + Mouse + Touch)
│   ├── entities.js         (Entity, Player, Enemy, Projectile, Pickup, Obstacle)
│   ├── weapon.js           (Weapon + Upgrade system)
│   ├── upgrades.js         (Specific upgrade classes)
│   ├── world.js            (Spawner, Obstacles, spatial grid)
│   ├── camera.js           (Camera follow logic)
│   ├── renderer.js         (Drawing + particles)
│   └── game.js             (Main loop, state machine, bootstrap)
└── [Optional] inline sprites / procedural drawing only
```

> **Note:** Despite the modular layout above, everything lives in a single `index.html` file using `<script>` tags or IIFEs. This document serves as the blueprint for implementing each section.

---

## Key Design Decisions

| Decision | Rationale |
|---|---|
| Single HTML file | Zero dependencies, instant open-and-play |
| Canvas 2D over WebGL | Simpler, sufficient for 2D, smaller codebase |
| Object pooling for entities | Prevents GC stalls during intense firefights |
| Spatial hash grid | O(1) collision broad-phase vs O(n²) brute force |
| Upgrade modifiers, not replacements | Enables crazy combos (e.g. 5-way homing curved spread) |
| Fixed timestep + delta interpolation | Consistent physics across frame rates |
| Touch joystick for mobile | Familiar gamepad-like control on phones |

---

---

## Bugfixes & Tweaks

| Fix | Description |
|---|---|
| Screen shake scaling (Step 3) | Consecutive hits stacked linearly, causing excessive shake. Changed to use `√amount` for diminishing returns, capped at `shakeAmount = 12` (was 20). Shake clears on game over / restart. |

---

## Extensibility Checklist (for future work)

- [ ] New weapon types (add to `Weapon` registry, different draw/fire logic)
- [ ] New enemy types (add AI behavior to `Enemy`)
- [ ] New obstacle shapes (rectangle, polygon support)
- [ ] Multiplayer (network layer, shared EntityManager)
- [ ] Boss enemies (large HP, multiple weapons, phase transitions)
- [ ] Save system (localStorage for high score / upgrade unlocks)
- [ ] WebGL renderer swap (same entity data, different draw calls)
- [ ] Level generation (procedural asteroid layouts, dungeon-style maps)
