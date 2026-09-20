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
│  │  │Player  │ │  Enemy   │ │ Projectile││ Health │  │  │
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
| **Spawner** | Wave logic, difficulty curve, enemy/optional-health/obstacle spawning |
| **Renderer** | Canvas drawing, camera matrix, sprites/particles |
| **UpgradeSystem** | Wave-end choices, build state, and data-driven effects (see §2) |
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

## 2. Survivors-Style Build System — Wave-End Choices

### Core Principle

> **The player creates a build by choosing one of three upgrades after each completed wave.**
> Enemies do not need to drop weapon upgrades. The existing shooting, enemy, wave, obstacle, collision, and HUD systems remain intact; the new system only supplies derived values and behavior flags to them.

The player starts every run with the already implemented laser. Upgrades strengthen that laser, improve survivability, or add projectile behavior. A selection pauses the action between waves, so the player can make a deliberate build decision instead of chasing random power-up drops.

### Build State and Derived Stats

Store only the level selected for each upgrade. Recalculate gameplay stats from that state whenever the player chooses an upgrade. Recalculation is deterministic: it avoids bugs caused by permanently mutating weapon values in an unclear order.

```js
player.upgradeLevels = { damage: 2, multishot: 1, pierce: 0 };

player.stats = {
  damageMultiplier: 1.5,
  fireCooldown: 0.12,
  projectileSpeed: 500,
  extraShots: 1,
  spread: 0.16,
  pierce: 0,
  homingStrength: 0,
  maxHpBonus: 0,
  moveSpeedMultiplier: 1,
};
```

`Weapon.fire()` reads the relevant derived stats when it creates projectiles. Projectiles copy the values they need (`damage`, `pierce`, `homingStrength`, and so on) on spawn. Exceptional mechanics such as homing or explosions use a small, reusable behavior check in the projectile/update/collision code—not a bespoke rewrite of the weapon for every upgrade.

### Upgrade Registry

All content belongs in one data registry. Adding or balancing an ordinary upgrade means editing this data, not adding another chain of `if` statements.

```js
const UPGRADES = {
  damage: {
    name: 'Overcharged Laser', maxLevel: 5, weight: 10,
    levels: [{ damageMultiplier: 1.20 }, { damageMultiplier: 1.20 }]
  },
  multishot: {
    name: 'Split Beam', maxLevel: 3, weight: 7,
    levels: [{ extraShots: 1, spread: 0.14 }]
  },
  // ...the remaining entries use the same shape
};
```

Each entry may contain `id`, `name`, `description`, `icon`, `maxLevel`, `weight`, optional `requires`, and per-level effects. An upgrade is eligible when it is not maxed and its prerequisites are met.

### Initial Catalogue — 10 Sample Upgrade Variants

| ID | Upgrade | Levels | Effect / role |
|---|---|---:|---|
| `damage` | Overcharged Laser | 5 | Raises projectile damage. Reliable general-purpose scaling. |
| `rapidFire` | Cooling Vents | 5 | Reduces fire cooldown; keeps the existing firing mechanic, just faster. |
| `multishot` | Split Beam | 3 | Adds side projectiles with controlled spread. |
| `pierce` | Phase Rounds | 4 | Lets a projectile damage additional enemies before despawning. |
| `projectileSpeed` | Particle Accelerator | 3 | Raises projectile speed and effective range/accuracy. |
| `homing` | Targeting Array | 3 | Gives spawned projectiles a gentle turn toward nearby enemies. |
| `explosion` | Volatile Core | 3 | Projectiles explode on death/hit, damaging enemies in a radius. Requires `pierce` level 1. |
| `maxHp` | Reinforced Hull | 3 | Increases maximum HP and immediately grants the gained HP. |
| `armor` | Deflector Plating | 3 | Reduces incoming damage by a small flat amount or percentage. |
| `thrusters` | Ion Thrusters | 3 | Increases player acceleration and/or maximum speed for safer positioning. |

The first six create the main offensive build paths. The last three ensure that a difficult wave can still offer a meaningful defensive or movement choice. `explosion` illustrates a prerequisite-driven synergy without forcing a complex ability graph.

### Wave-End Offer Flow

```
wave cleared
  → stop spawning and remove remaining enemy projectiles
  → game state: "upgrade_select" (game simulation paused)
  → filter eligible upgrades; choose 3 distinct weighted offers
  → player clicks/taps one card
  → increment its level; rebuild player.stats
  → begin the next wave
```

Offers never contain an upgrade that has reached `maxLevel`. Weights can later make rare/strong options less common, and the selection code should draw without replacement so no card is repeated in one choice screen. Health may remain a rare enemy drop or be awarded as a small between-wave recovery, but it is separate from build upgrades.

### Interaction Rules

1. **Stat upgrades combine predictably.** Add flat values first, then multiply where needed; document the formula in `rebuildPlayerStats()`.
2. **Projectile behavior is field-based.** A projectile with `pierce: 2` and `homingStrength: 40` simply uses both checks during its lifetime.
3. **Event effects stay small and generic.** For example, the collision code checks `explosionRadius > 0` and calls one shared area-damage helper.
4. **Order does not affect the build.** Selecting damage before multishot produces the same result as selecting multishot before damage.
5. **Keep the catalogue data-driven.** A new numerical upgrade should normally require one registry entry; add code only when it introduces a truly new behavior.

---

## 3. Step-by-Step Implementation Plan (9 Steps)

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

### Step 5 — Wave-Clear State & Transition Gate
**Goal:** Establish a reliable pause point between waves, without yet adding upgrade content or UI.

| What | Details |
|---|---|
| Wave-clear detection | Reuse the existing spawner/enemy count; when a fully spawned wave has no enemies remaining, emit one wave-clear event. |
| State transition | Add `playing → upgrade_select`; prevent the spawner from automatically starting the next wave. |
| Simulation pause | While in `upgrade_select`, pause movement, collisions, firing, enemy projectiles, and spawning. |
| Temporary feedback | Show a minimal “Wave Clear — choose an upgrade” prompt so the state can be verified before the card UI exists. |
| Transition safety | Guard against duplicate wave-clear events and reset the gate on restart. |

**Deliverable:** Clearing a wave reliably freezes gameplay at one explicit between-wave state; Steps 1–4 need no redesign or replacement.

---

### Step 6 — Upgrade Data, Build State & Offers
**Goal:** Create the data model that can generate a valid choice without directly mutating gameplay values.

| What | Details |
|---|---|
| `UPGRADES` registry | Define the 10 sample upgrades, their levels, weights, descriptions, and prerequisites. |
| Build state | Add `player.upgradeLevels` and `rebuildPlayerStats()`; rebuild from base values after every choice. |
| Eligibility | Filter upgrades that are maxed or have unmet prerequisites. |
| Offer generator | Select three distinct eligible upgrades by weight, without replacement; handle a smaller eligible pool gracefully. |
| Choice contract | Represent an offer as an upgrade ID plus its current and next level/effect, ready for a UI to render. |

**Deliverable:** At a wave-clear state, the game can produce a deterministic, valid set of upgrade offers from a single registry.

---

### Step 7 — Upgrade Selection UI & Wave Resume
**Goal:** Let the player choose an offered upgrade by mouse or touch, then safely begin the next wave.

| What | Details |
|---|---|
| Upgrade overlay | Render up to three clickable/tappable cards with icon, name, current/next level, and concise effect text. |
| Input routing | Enable card input only in `upgrade_select`; prevent click/tap events from also firing the weapon. |
| Apply choice | Increment `player.upgradeLevels[id]`, call `rebuildPlayerStats()`, and refresh any relevant HUD state. |
| Resume | Hide the overlay, clear the temporary transition state, and explicitly start the next wave. |
| Health between waves | Optionally grant a small heal or retain rare health drops; neither is an upgrade-card choice. |

**Deliverable:** Completing a wave presents valid choices; selecting one applies it once and starts the next wave.

---

### Step 8 — Weapon Stats, Projectile Behaviors & Build HUD
**Goal:** Connect the derived build state to combat through generic, composable projectile mechanics.

| What | Details |
|---|---|
| Weapon integration | Read damage, cooldown, projectile speed, extra shots, and spread from `player.stats`; preserve the current `Weapon` and projectile pool. |
| Projectile fields | Add `pierce`, `homingStrength`, and `explosionRadius` with safe base values of zero. |
| Reusable effects | Implement generic homing steering, pierce decrement on enemy hit, and an area-damage helper for explosions. |
| Defensive and movement stats | Apply max-HP, armor, and thruster effects through the same derived-stat rebuild. |
| Build HUD | Show selected upgrades and levels in a compact panel for gameplay clarity and testing. |

**Deliverable:** Runs can form distinct damage, rapid-fire, spread, piercing, homing, explosive, durable, or mobile builds while retaining the existing combat systems.

---

### Step 9 — Polish & Meta-Game
**Goal:** Visual polish, audio, UI, difficulty scaling, restart.

| What | Details |
|---|---|
| Particles | Death explosions, engine thrust trails, upgrade-card/pickup glow |
| Visual effects | ~~Screen shake on hit~~, ~~damage flash~~, ~~game over / restart~~, ~~minimap~~, ~~wave HUD~~, weapon-specific bullet effects |
| UI | ~~Score~~, ~~HP bar~~, weapon indicator, wave-end upgrade cards, upgrade inventory panel |
| Waves / Difficulty | ~~Progressive enemy count~~, ~~speed~~, ~~HP scaling~~ |
| Game states | ~~Playing~~ → Upgrade Select → ~~Game Over~~ → Restart |
| Audio | Web Audio API: shoot, hit, explosion, wave-clear, upgrade-select SFX (procedural) |
| Performance | ~~Object pooling~~, batch rendering, `will-change` optimization |

> **Partially done in Step 3:** screen shake, damage flash, game over state, restart, wave system, HUD, minimap.
> **Remaining:** wave-end upgrade selection, particles (explosions, trails), audio, upgrade inventory panel, weapon-specific bullet effects.

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
│   ├── entities.js         (Entity, Player, Enemy, Projectile, optional Health, Obstacle)
│   ├── weapon.js           (Weapon reads derived build stats)
│   ├── upgrades.js         (UPGRADES data registry + rebuildPlayerStats)
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
| Data-driven wave-end upgrades | Scales a survivors-style build without replacing implemented combat systems |
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
