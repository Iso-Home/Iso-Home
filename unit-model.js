/*  unit-model.js — the parametric unit model, headless of its interface.
 *
 *  Lifted out of apartment-3d.html unchanged: same CONFIG, same derivation,
 *  same geometry, clearance engine and OBJ/glTF exporters. Everything that
 *  drew a panel is gone — the interface lives in the .dc.html now and reads
 *  this through the API at the bottom of the factory.
 *
 *      const api = UnitModel.create(canvasEl, { onChange, onStatus });
 *
 *  onChange fires whenever the model mutates (placement, dimension, undo);
 *  onStatus carries the save and refusal messages.
 */
(function () {
'use strict';

function createUnitModel(canvas, opts) {
  opts = opts || {};

'use strict';

/* ══════════════════════════════════════════════════════════════════
   PLANS — the model holds more than one apartment.

   Everything specific to a floor plan lives inside one entry of the
   PLANS registry below: its CONFIG defaults, its derive(), the walls it
   emits, its casework, its room list, and the notes the Fit tab prints.
   Everything outside the registry — the renderer, the catalog, the
   constraint solver, the area rasteriser, persistence — is shared and
   knows nothing about any particular plan.

   Adding a third apartment means adding a third entry, not editing the
   engine. `U` is the active entry; `C` is its live config; `G` is
   derive(C). selectPlan() swaps all three.

   Axes are the same for every plan: X runs west→east, Y north→south,
   origin at the interior north-west corner of the envelope, and an
   outdoor bump-out (balcony or patio) sits at negative Y.
   ══════════════════════════════════════════════════════════════════ */
const PLANS = [];
const planById = id => PLANS.find(p => p.id === id) || PLANS[0];

/* ══════════════════════════════════════════════════════════════════
   GOLDRIDGE / UNIT 14 — 650 sq ft, sheet A-101

   Every value below is read off sheet A-101, "One-Bedroom Apartment"
   (Design.pdf). Replace any of them and the whole plan re-derives:
   walls, openings, casework, room labels, dimension strings, the area
   report and the clearance analysis. There is not one hard-coded
   coordinate below.
   ══════════════════════════════════════════════════════════════════ */
const PLAN_A101 = {
  /* ── FIELD-MEASURED, 2026-08-01. Mac's tape, taken in the unit, and it
        SUPERSEDES sheet A-101 — the sheet said as much ("inferred from a 3D
        reference, field-verify"), and it is out by a lot: the drawing is
        3′-10″ too WIDE and its dining room is more than twice the area of the
        real one. Depth it gets to within 3″. Room topology is unchanged: the
        rooms the sheet shows are the rooms that are there, in the same places.

        Numbers marked ▸ are tape. Everything else is still inferred and is
        what to measure next; the Fit tab lists them.

        Consequence worth keeping in view: at these dimensions the unit is
        ~562 sf gross, not the 650 sf advertised. ── */
  W:      24 +  2/12,  // ▸ interior width,  west→east  · 24′-2″  = bedW + 4″ + living
  D:      23 +  3/12,  // ▸ interior depth, north→south · 23′-3″  = living + dining
  ceiling: 8,
  bedW:   10 + 11/12,  // ▸ bedroom, north-west corner  · 10′-11″
  bedD:   10 + 11/12,  // ▸   square                    × 10′-11″
  livD:   15 +  4/12,  // ▸ living-room depth           · 15′-4″
  partyD: 11 +  9/12,  // ▸ living/bedroom party wall   · 11′-9″
  bathW:   5 +  6/12,  //   bathroom width — NOT MEASURED, back-solved from
                       //   W − 4″ − kitW − dining, so it absorbs the slop
  bathD:   8 +  4/12,  // ▸   = kitchen depth           ×  8′-4″
  kitW:    9 + 10/12,  // ▸ kitchen run length          ·  9′-10″

  /* ── closets and the north-east bump-out ── */
  wdW:     2 +  2/12,       //   W/D alcove — NOT MEASURED, set so the
                            //   vestibule derives to the 8′-9″ hallway Mac taped
  closW:   6 + 10/12,       // ▸ bedroom reach-in      ·  6′-10″
  closD:   1 + 11/12,       // ▸                       ×  1′-11″
  balcW:  10 +  2.5/12,     // ▸ balcony               · 10′-2½″
  balcD:   5 +  7.5/12,     // ▸   deck, wall to rail  ×  5′-7½″
  storW:   2 +  7/12,       //   storage off the balcony — NOT MEASURED
  storD:   2 +  7/12,       //   coat closet matches   — NOT MEASURED

  /* ── glazing — the bedroom window is the only confirmed opening ── */
  winX:    1,          // from the west interior face
  winW:    5.5,        // 5′-6″ wide
  winSill: 3, winHead: 6 + 8/12,

  /* ── second storey. The revised sheet puts the entry back on the EAST
        wall, which matches the street view: a straight flight parallel to
        the wall, up to a landing at the door. Balcony stays private. ── */
  mirror: false,
  floorToFloor: 9,     // finished floor above grade  ·  9′-0″
  entryY:  0.5,        // entry, down from the north-east corner
  landD:   7.5,        // walkway projection: 3′-6″ stairwell + 4′-0″ pass strip
  landW:  1.5,         // walkway run past the door before the flight starts
  stairW:  3.5,        // stair width
  tread:  11/12,       // 11″ run
  /* street view: this is a COMMON stair in the slot between two units, not a
     private stoop. Guards are solid panels; the flights have open risers. */
  guardH:  3.5, solidGuard: true, openRiser: true,
  neighbour: true,     // stub of the adjacent unit, so the slot reads

  /* ── near-certain US residential constants ──
     Partitions are 4″, not the 4½″ in the sheet's note: 4″ is what the plan
     is drawn at and the only value at which the room schedule tiles exactly —
     14′-8″ + 4″ + 15′-0″ = 30′-0″, and 12′-0″ + 4″ + 3′-8″ + 4″ + 5′-8″ = 22′-0″. */
  wallInt: 4/12, wallExt: 8/12,
  doorInt:  32/12, doorEntry: 36/12, doorH: 80/12,
  sliderW:   7, bypass: 2.5,
  counterH: 36/12, counterD:  25/12, upperStart: 54/12, upperH: 30/12,
};

/* ══ derivation ═══════════════════════════════════════════════════
   The tiling identities — what makes the plan re-solve instead of
   leaving orphan strips when a number changes:
       livW  = W − bedW − wallInt         (the two bands must sum to W)
       dinD  = D − livD                   (living stacks on dining)
       utilD = D − bedD − bathD − 2·wallInt   (the W/D band is the remainder)
       kitD  = bathD                      (kitchen shares the bathroom band)
       coatD = balcD − wallExt − wallInt − storD  (closets fill the bump-out)
       bumpW = storW + wallInt + balcW    (bump-out = closets + balcony)

   NOTE, changed 2026-08-01: the living room used to be forced to bedD — the
   sheet drew the bedroom spanning its whole west side. The tape says
   otherwise. The bedroom is 10′-11″ deep, the living room 15′-4″, and the
   difference is the hallway mouth opening off it. So living depth is its own
   measured field (livD) and dining is what is left below it. Forcing the old
   identity back would shorten the living room by 4′-5″.
   ══════════════════════════════════════════════════════════════════ */
function deriveA101(c) {
  const { W, D, bedW, bedD, livD, bathW, bathD, kitW, wdW, closW, closD,
          balcW, balcD, storW, storD, wallInt: i, wallExt: e } = c;

  /* stair — risers divide the storey height as evenly as they can while
     staying under the 7¾″ code maximum, so changing floorToFloor re-solves
     the flight instead of leaving a short step at the bottom. */
  const nRise = Math.max(2, Math.ceil(c.floorToFloor / (7.5/12)));
  const riser = c.floorToFloor / nRise;
  const run   = (nRise - 1) * c.tread;

  const livW  = W - bedW - i;             // 12′-11″ — living takes what's left
  const kitD  = bathD;                    //  8′-4″ — kitchen shares the bath band
  const dinW  = W - bathW - i - kitW;     //  8′-6″
  const dinD  = D - livD;                 //  7′-11″ — dining is what is left below
  const utilD = D - bedD - bathD - 2*i;   //  3′-4″ — the W/D band is the remainder
  const coatD = balcD - e - i - storD;    //  2′-7″
  const bumpW = balcW + i + storW;        // 13′-11″

  const lx    = bedW + i;                 // living-room west face
  const ky    = D - bathD;                // bath / kitchen band, north face
  const kx    = bathW + i;                // kitchen west end
  const cy    = bedD - closD;             // reach-in front face
  const uy0   = bedD + i, uy1 = ky - i;   // the W/D band, north and south faces
  const balcX = W - storW - i - balcW;    // balcony west face
  const by    = -(coatD + e);             // coat closet north face
  const sy    = -balcD;                   // storage closet north face

  /* the flight lands at the balcony's west wall and descends westward along
     the bedroom's north face. run must stay inside that wall — the Fit tab
     grades it, because a longer storey height pushes the bottom step past it. */
  /* Common walkway outside the east-wall door, running from the building's
     north-east corner south past the door; the flight descends from its far
     end, parallel to the wall. Street view shows this as a shared stair in
     the slot between two units, not a private stoop. */
  const landY0 = -e;
  /* The walkway is shared, so it does not stop past this door — it runs on to
     the next apartment's, about three times the single-door landing it began
     as, which is roughly the pitch these units repeat at. */
  const landY1 = landY0 + ((c.entryY + c.doorEntry + c.landW) - landY0) * 3;
  const doorC  = c.entryY + c.doorEntry/2;             // this unit's door
  const nbrDoorC = landY1 - (doorC - landY0);          // the next one's, mirrored
  /* the common flight sits midway between the two doors, so neither apartment
     owns it and both walk the same distance to it */
  const stairMid = (doorC + nbrDoorC) / 2;
  const stairY1 = stairMid + run/2, stairY0 = stairMid - run/2;
  const landX0 = W + e, landX1 = landX0 + c.landD;
  /* the stairwell is outboard; the pass strip hugs the wall the doors are in,
     so the deck stays walkable end to end */
  const stairX1 = landX1, stairX0 = landX1 - c.stairW;
  const nbrX   = landX0 + Math.max(c.landD, c.stairW) + 0.5;   // adjacent unit

  return {
    livW, kitD, dinW, dinD, utilD, coatD, bumpW, lx, kx, ky, cy, uy0, uy1, balcX,
    nRise, riser, run, landY0, landY1, stairY0, stairY1, landX0, landX1, stairX0, stairX1, nbrX,
    doorC, nbrDoorC,
    rooms: {
      bedroom: [0, 0, bedW, bedD],
      closet:  [0, cy, closW, bedD],
      living:  [lx, 0, W, livD],
      vest:    [wdW, uy0, bedW, uy1],
      wd:      [0, uy0, wdW, uy1],
      bath:    [0, ky, bathW, D],
      kitchen: [kx, ky, kx + kitW, D],
      dining:  [W - dinW, D - dinD, W, D],
      coat:    [W - storW, by, W, -e],
      storage: [W - storW, sy, W, by - i],
    },
    balcony:   [balcX, -(balcD + e), balcX + balcW, -e],
    /* openings, each expressed against the wall it sits in */
    op: {
      window:   [c.winX, c.winX + c.winW],                  // north wall, bedroom
      /* the revised sheet centres the slider on the balcony and moves the
         entry to the east wall, so the balcony is private again */
      slider:   [balcX + (balcW - 6)/2, balcX + (balcW + 6)/2],  // north wall
      entry:    [c.entryY, c.entryY + c.doorEntry],              // EAST wall (a Y-range)
      coatDoor: [W - storW + 0.125, W - 0.125],             // north wall, into the living room
      storDoor: [sy + 0.3, by - i - 0.3],                   // balcony/closet divider
      bedDoor:  [bedW - 1 - c.doorEntry, bedW - 1],         // bedroom south wall
      bathDoor: [wdW, wdW + c.bypass],                      // bath north wall
      closDoor: [0, closW],                                 // reach-in bypass, full width
    },
  };
}

/* validity — surfaced in the Fit tab rather than silently mis-drawing */
function problemsA101(c, g) {
  const p = [];
  if (g.livW  <= 8) p.push(`Living width derives to ${ftin(g.livW)} — the bedroom is eating the east side.`);
  if (g.utilD <= 1.5) p.push(`W/D band derives to ${ftin(g.utilD)} — bedroom + bathroom leave no vestibule.`);
  if (g.dinW  <= 5) p.push(`Dining width derives to ${ftin(g.dinW)} — bath + kitchen span the whole south wall.`);
  if (g.dinD  <= 5) p.push(`Dining depth derives to ${ftin(g.dinD)} — the living room takes the whole plan.`);
  if (c.livD  <= c.bedD) p.push(`Living depth ${ftin(c.livD)} is no deeper than the bedroom — the hallway has no mouth to open off.`);
  if (c.partyD > c.livD) p.push(`Party wall ${ftin(c.partyD)} is longer than the living room it sits in.`);
  if (g.coatD <= 1) p.push(`Coat closet derives to ${ftin(g.coatD)} — the storage closet fills the bump-out.`);
  if (c.closW >  c.bedW)  p.push('Reach-in closet is wider than the bedroom.');
  if (c.wdW   >  c.bedW)  p.push('W/D alcove is wider than the band it sits in.');
  if (g.balcX <  c.bedW)  p.push('Balcony bump-out overruns the bedroom — it would sit off the living room wall.');
  if (c.winX + c.winW > c.bedW) p.push('Bedroom window runs past the bedroom into the living room.');
  if (c.entryY + c.doorEntry > c.livD) p.push('Entry door runs past the living room on the east wall.');
  return p;
}

/* ══ active plan ═══════════════════════════════════════════════════
   `U` is the entry from PLANS being drawn, `C` its live config, `G` the
   derivation. Everything downstream reads these three and nothing else,
   which is what lets a second apartment drop in without touching the
   engine. They are assigned by selectPlan(), below the registry. ════ */
let U = null, C = {}, G = {};

/* ══ math ══════════════════════════════════════════════════════════ */
const RAD = d => d * Math.PI / 180;
const sub = (a,b) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
const dot = (a,b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
const cross = (a,b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const norm = a => { const m = Math.hypot(a[0],a[1],a[2]) || 1; return [a[0]/m,a[1]/m,a[2]/m]; };
const clamp = (v,a,b) => v < a ? a : v > b ? b : v;
let UNITS = 'ft';
const ftin = f => {
  if (UNITS === 'm') return (f * 0.3048).toFixed(2) + ' m';
  const n = f < 0; f = Math.abs(f);
  let ft = Math.floor(f + 1e-6), i = Math.round((f - ft) * 12);
  if (i === 12) { ft++; i = 0; }
  return (n?'-':'') + ft + '′' + (i ? ' ' + i + '″' : '');
};
const inches = f => Math.round(f * 12) + '″';

/* ══ materials ═════════════════════════════════════════════════════ */
const M = {
  oak:{c:[198,175,146]}, tile:{c:[216,216,212]}, deck:{c:[158,154,147]},
  wall:{c:[236,231,223],edge:1}, poche:{c:[168,157,142]},
  counter:{c:[58,56,53],edge:1}, cab:{c:[224,217,206],edge:1},
  appl:{c:[176,180,184],edge:1}, porc:{c:[246,246,244],edge:1},
  rail:{c:[122,126,130],edge:1}, uphol:{c:[142,154,166],edge:1},
  glass:{c:[176,201,212],edge:1},
  wood:{c:[156,123,84],edge:1}, dark:{c:[74,71,65],edge:1},
  walnut:{c:[113,76,50],edge:1}, blackash:{c:[40,38,36],edge:1}, steel:{c:[46,46,48],edge:1}, fabric:{c:[62,64,70],edge:1},
  rugm:{c:[168,144,122],edge:1}, metal:{c:[122,126,130],edge:1},
  leaf:{c:[110,139,94],edge:1}, screen:{c:[38,40,44],edge:1},
  sel:{c:[196,112,58],edge:1},
};

/* ══ scene primitives ══════════════════════════════════════════════ */
let quads = [], floorQuads = [], blockers = [], wallRects = [];
/* Every quad carries the part it belongs to. On screen this is inert; on
   export it becomes the object name, so the .obj/.gltf opens as separate
   selectable pieces (walls, kitchen, bath, …) instead of one welded blob. */
let GRP = 'shell';
const faceN = v => norm(cross(sub(v[1],v[0]), sub(v[2],v[0])));
function pushQ(v, m, into){ (into||quads).push({ v, n: faceN(v), m, g: GRP }); }

function box(x0,y0,z0, x1,y1,z1, m, topM, into) {
  if (x1<=x0 || y1<=y0 || z1<=z0) return;
  const t = topM || m;
  const A=[x0,y0,z0],B=[x1,y0,z0],Cc=[x1,y1,z0],Dd=[x0,y1,z0];
  const E=[x0,y0,z1],F=[x1,y0,z1],Gg=[x1,y1,z1],H=[x0,y1,z1];
  pushQ([E,F,Gg,H], t, into); pushQ([A,Dd,Cc,B], m, into);
  pushQ([A,B,F,E], m, into);  pushQ([Cc,Dd,H,Gg], m, into);
  pushQ([Dd,A,E,H], m, into); pushQ([B,Cc,Gg,F], m, into);
}

let GHOST = false;   // drawn walls vs. walls that only block furniture
function wallX(x0,x1, y0,y1, z0,z1, ops, m) {
  if (z1 <= z0) return;
  if (GHOST) { blockers.push([x0,y0,x1,y1]); return; }
  const L = (ops||[]).slice().sort((a,b)=>a[0]-b[0]);
  let cx = x0;
  const seg=(a,b)=>{ box(a,y0,z0,b,y1,z1,m,M.poche);
    if(z0<=.01){ blockers.push([a,y0,b,y1]); wallRects.push([a,y0,b,y1]); } };
  for (const [a,b,oz0,oz1] of L) {
    const A = Math.max(a,x0), B = Math.min(b,x1);
    if (B <= A) continue;
    if (A > cx) seg(cx,A);
    if (oz0 > z0) box(A,y0,z0, B,y1,Math.min(oz0,z1), m, M.poche);
    if (oz1 < z1) box(A,y0,Math.max(oz1,z0), B,y1,z1, m, M.poche);
    cx = Math.max(cx,B);
  }
  if (cx < x1) seg(cx,x1);
}
function wallY(y0,y1, x0,x1, z0,z1, ops, m) {
  if (z1 <= z0) return;
  if (GHOST) { blockers.push([x0,y0,x1,y1]); return; }
  const L = (ops||[]).slice().sort((a,b)=>a[0]-b[0]);
  let cy = y0;
  const seg=(a,b)=>{ box(x0,a,z0,x1,b,z1,m,M.poche);
    if(z0<=.01){ blockers.push([x0,a,x1,b]); wallRects.push([x0,a,x1,b]); } };
  for (const [a,b,oz0,oz1] of L) {
    const A = Math.max(a,y0), B = Math.min(b,y1);
    if (B <= A) continue;
    if (A > cy) seg(cy,A);
    if (oz0 > z0) box(x0,A,z0, x1,B,Math.min(oz0,z1), m, M.poche);
    if (oz1 < z1) box(x0,A,Math.max(oz1,z0), x1,B,z1, m, M.poche);
    cy = Math.max(cy,B);
  }
  if (cy < y1) seg(cy,y1);
}

/* ══ handing ═══════════════════════════════════════════════════════
   CONFIG and derive() always describe the plan exactly as sheet A-101
   draws it. This unit is the mirror of that sheet, so every X is
   reflected through the envelope centreline on the way into the world:

       mSpan(a,b) → [W−b, W−a]

   The reflection is applied to *spans*, in ascending order, so each box
   stays a correctly-wound box — only the assembly flips. That matters:
   the building mirrors, individual pieces do not. Furniture is emitted
   after this and is deliberately NOT mirrored, because a mirrored unit
   does not come with a mirrored sofa.

   Anything that reads G.rooms for a purpose other than drawing — labels,
   routes, seeding, keep-out — goes through mRect for the same reason.
   ══════════════════════════════════════════════════════════════════ */
const mSpan = (a, b) => C.mirror ? [C.W - b, C.W - a] : [a, b];
const mRect = r => C.mirror ? [C.W - r[2], r[1], C.W - r[0], r[3]] : r;
const mOps  = ops => C.mirror
  ? (ops || []).map(o => [C.W - o[1], C.W - o[0], o[2], o[3]]) : (ops || []);

/* emission wrappers — the only way the shell touches the world */
const WX = (x0,x1, y0,y1, z0,z1, ops, m) => {
  const s = mSpan(x0,x1); wallX(s[0],s[1], y0,y1, z0,z1, mOps(ops), m); };
const WY = (y0,y1, x0,x1, z0,z1, ops, m) => {          // ops are Y-ranges: unflipped
  const s = mSpan(x0,x1); wallY(y0,y1, s[0],s[1], z0,z1, ops || [], m); };
const BX = (x0,y0,z0, x1,y1,z1, m, tm, into) => {
  const s = mSpan(x0,x1); box(s[0],y0,z0, s[1],y1,z1, m, tm, into); };
const FQ = (x0,y0, x1,y1, z, m) => {
  const s = mSpan(x0,x1);
  pushQ([[s[0],y0,z],[s[1],y0,z],[s[1],y1,z],[s[0],y1,z]], m, floorQuads); };

/* a box whose top slopes along Y — zA at y0, zB at y1. The stair handrail.
   Faces are listed in box()'s own order so the winding matches; mirroring
   only flips X, so the slope ends stay put. */
function RMP(x0,x1, y0,y1, zA,zB, t, m) {
  const [a,b] = mSpan(x0,x1);
  const E=[a,y0,zA], F=[b,y0,zA], Gg=[b,y1,zB], H=[a,y1,zB];
  const A=[a,y0,zA-t], Bb=[b,y0,zA-t], Cc=[b,y1,zB-t], Dd=[a,y1,zB-t];
  pushQ([E,F,Gg,H], m);  pushQ([A,Dd,Cc,Bb], m);
  pushQ([A,Bb,F,E], m);  pushQ([Cc,Dd,H,Gg], m);
  pushQ([Dd,A,E,H], m);  pushQ([Bb,Cc,Gg,F], m);
}

/* ══ shell ═════════════════════════════════════════════════════════ */
let showFixtures = true, wallMode = 'cut', EXPORTING = false;
const CUT = 4.5;
const wallTop = () => wallMode === 'full' ? C.ceiling : Math.min(CUT, C.ceiling - 0.5);

/* Shared scaffolding. The walls themselves come from the active plan —
   buildShell() only clears the buffers and fixes the emission order, so
   that `blockers` and `wallRects` mean the same thing for every plan. */
function buildShell() {
  quads = []; floorQuads = []; blockers = []; wallRects = [];
  U.shell(C, G, wallTop());
  if (showFixtures) U.fixtures(C, G);
  GRP = 'shell';
}

function shellA101(C, G, h) {
  const { W, D, wallExt: e, wallInt: i, doorH: dh, balcD, storW, bedW, bedD, closW } = C;
  const { rooms: R, balcony: B, op, ky, uy0, uy1, cy, balcX, kx } = G;

  /* floors */
  GRP = 'floor';
  FQ(0, 0, W, D, 0, M.oak);
  FQ(R.bath[0], R.bath[1], R.bath[2], R.bath[3], .03, M.tile);
  FQ(R.kitchen[0], R.kitchen[1], R.kitchen[2], R.kitchen[3], .03, M.tile);
  /* the bump-out: balcony deck, plus the closet stack floor at its east end */
  BX(B[0] - e, B[1], -0.42, B[2], B[3], 0, M.deck, null, floorQuads);
  FQ(W - storW, R.storage[1], W, -e, 0, M.oak);

  /* exterior — doll's house culling at full height (never while exporting:
     a ghosted wall is drawn as nothing, which would leave a hole in the mesh).
     The entry-side wall is the east one as drawn, west when mirrored, so the
     cull test has to follow the wall rather than the raw coordinate. */
  GRP = 'walls';
  const ep = eye(), cull = wallMode === 'full' && !EXPORTING;
  const camEntry = C.mirror ? ep[0] < 0 : ep[0] > W;
  const camFar   = C.mirror ? ep[0] > W : ep[0] < 0;
  GHOST = cull && ep[1] < 0;
  /* north wall: the bedroom window (the one confirmed opening), the slider
     centred on the balcony, and the coat-closet bifold */
  WX(-e, W+e, -e, 0, 0, h, [
      [op.window[0],   op.window[1],   C.winSill, C.winHead],
      [op.slider[0],   op.slider[1],   0, dh],
      [op.coatDoor[0], op.coatDoor[1], 0, dh]], M.wall);
  GHOST = cull && ep[1] > D;
  WX(-e, W+e, D, D+e, 0, h, [], M.wall);                // no glazing confirmed
  GHOST = cull && camFar;
  WY(-e, D+e, -e, 0, 0, h, [], M.wall);
  GHOST = cull && camEntry;
  // east wall — carries the entry, and runs north past the closets
  WY(-(balcD+e), D+e, W, W+e, 0, h, [[op.entry[0], op.entry[1], 0, dh]], M.wall);
  GHOST = false;

  /* ── glazing ──
     Clamped to the current wall top so it gets cut with the walls; drawn to
     full head height it spikes above the cutaway and reads as a floating slab. */
  GRP = 'glazing';
  const gz = z => Math.min(z, h);

  // bedroom window
  if (gz(C.winHead) > C.winSill)
    BX(op.window[0], -e*0.6, C.winSill, op.window[1], -e*0.4, gz(C.winHead), M.glass);

  /* sliding glass door onto the balcony — two leaves in two tracks, the
     outboard one fixed, so it reads as a slider and not an empty hole */
  const [sa, sb] = op.slider, sw = (sb - sa) / 2, ft = 0.12;
  const leaf = (x0, x1, yc) => {
    const top = gz(dh);
    if (top <= 0.12) return;
    BX(x0, yc - .03, .12, x1, yc + .03, top - .08, M.glass);        // pane
    BX(x0, yc - .05, .12, x0 + ft, yc + .05, top, M.rail);          // stiles
    BX(x1 - ft, yc - .05, .12, x1, yc + .05, top, M.rail);
    BX(x0, yc - .05, 0, x1, yc + .05, .12, M.rail);                 // bottom rail
    if (top >= dh - .01) BX(x0, yc - .05, top - .08, x1, yc + .05, top, M.rail);
  };
  leaf(sa, sa + sw, -e * 0.72);        // outboard, fixed
  leaf(sa + sw, sb, -e * 0.32);        // inboard, sliding

  /* bump-out shell — north wall spans the closets only; the balcony gets a rail */
  GRP = 'walls';
  WX(W - storW - i, W+e, -(balcD+e), -balcD, 0, h, [], M.wall);

  /* interior partitions — all derived */
  /* bedroom east wall — the living/bedroom party wall. Taped at 11′-9″, which
     runs it past the bedroom's south-west corner and on to form the return at
     the hallway mouth, so it is its own measurement rather than bedD + 4″. */
  WY(0, C.partyD, bedW, bedW+i, 0, h, [], M.wall);
  // bedroom south wall — the door opens off the vestibule
  WX(-e, bedW+i, bedD, uy0, 0, h, [[op.bedDoor[0], op.bedDoor[1], 0, dh]], M.wall);
  // bedroom reach-in: east end wall, and the bypass head across its north face
  WY(cy - i, bedD, closW, closW+i, 0, h, [], M.wall);
  WX(-e, closW+i, cy - i, cy, 0, h, [[op.closDoor[0], op.closDoor[1], 0, dh]], M.wall);
  // bath + kitchen north wall. It stops at the bedroom line, and the bar runs
  // on past it — that gap is the pass-through, with a bulkhead over.
  WX(-e, bedW, uy1, ky, 0, h, [[op.bathDoor[0], op.bathDoor[1], 0, dh]], M.wall);
  WX(bedW, kx + C.kitW, uy1, ky, dh, h, [], M.wall);    // bulkhead, full-height mode only
  // bathroom east wall — solid
  WY(uy1, D, C.bathW, C.bathW+i, 0, h, [], M.wall);
  // the bump-out closet stack: west wall carries the storage door onto the balcony
  WY(-balcD, -e, W - storW - i, W - storW, 0, h, [[op.storDoor[0], op.storDoor[1], 0, dh]], M.wall);
  WX(W - storW - i, W+e, R.coat[1] - i, R.coat[1], 0, h, [], M.wall);

  /* balcony guard — north and west edges; only the east side is a wall */
  GRP = 'railing';
  guard(B[0] - e, B[1], B[2], B[1] + 0.35, C.guardH);
  guard(B[0] - e, B[1], B[0] - e + 0.35, B[3], C.guardH);

  buildEntryStair();
}

/* ══ common walkway + entry stair ══════════════════════════════════
   Second-storey unit, entry on the east wall. Modelled on the street view
   rather than the sheet, which draws none of this:

     · a COMMON stair in the slot between two units, not a private stoop —
       hence the walkway running the length of the east wall and the stub
       of the adjacent unit east of the flight
     · the flight descends NORTH off the landing, away from the door
     · open risers, so the flight reads light and you can see through it
     · guards are solid panels at 3′-6″, not balusters

   All four are CONFIG switches (`neighbour`, `openRiser`, `solidGuard`,
   `guardH`) and every dimension still follows floorToFloor.
   ═══════════════════════════════════════════════════════════════════ */
function buildEntryStair() {
  const { wallExt: e, stairW, tread, floorToFloor: ff, guardH: gh } = C;
  const { nRise, riser, run, landY0, landY1, stairY0, stairY1, landX0, landX1,
          stairX0, stairX1, nbrX, nbrDoorC } = G;
  const rt = 0.12;

  /* the storey below, as a slab edge — without it the stair descends from
     nothing and the unit reads as sitting on the ground. Perimeter bands
     only: floors paint before walls and unsorted, so a full-footprint slab
     would sit in `quads` and cover the floor it is supposed to be under. */
  GRP = 'structure';
  const t = 1.0, W = C.W, D = C.D;
  BX(-e, -e, -t, W+e, 0,   -0.02, M.poche);
  BX(-e,  D, -t, W+e, D+e, -0.02, M.poche);
  BX(-e,  0, -t, 0,   D,   -0.02, M.poche);
  BX( W,  0, -t, W+e, D,   -0.02, M.poche);

  /* The shared walkway, running the length of the east wall between two doors.
     Decked as three strips around the stairwell, not one slab — the flight
     drops through the opening, so there must genuinely be a hole there. */
  GRP = 'landing';
  BX(landX0, landY0, -0.75, stairX0, landY1, 0, M.deck);     // pass strip, full length
  BX(stairX0, landY0, -0.75, landX1, stairY0, 0, M.deck);    // outboard, north of the well
  BX(stairX0, stairY1, -0.75, landX1, landY1, 0, M.deck);    // outboard, south of the well
  /* Outer edge in two runs: the stairwell interrupts it, and the flight's own
     sloped rail carries that stretch. Both ends of the deck are stops now that
     the flight is in the middle, so both get a panel. */
  guard(landX1 - rt, landY0, landX1, stairY0, gh);
  guard(landX1 - rt, stairY1, landX1, landY1, gh);
  guard(stairX0, stairY0, stairX0 + rt, stairY1, gh);        // stairwell, inboard side
  guard(landX0, landY0, landX1, landY0 + rt, gh);            // north end
  guard(landX0, landY1 - rt, landX1, landY1, gh);            // south end

  /* the next apartment's door, applied to the wall face — its interior is not
     modelled, and the deck's length is only legible with both doors on it */
  BX(landX0 - 0.02, nbrDoorC - C.doorEntry/2, 0, landX0 + 0.1, nbrDoorC + C.doorEntry/2, C.doorH, M.wood);

  /* the flight: top step at the landing's NORTH end, descending northward —
     off the door you turn away from the unit and walk down toward the street
     end of the slot, which is the way it runs on site */
  GRP = 'stairs';
  for (let k = 1; k <= nRise; k++) {
    const zt = -k * riser, ya = stairY1 - k * tread;
    if (k < nRise) BX(stairX0, ya, zt - 0.22, stairX1, ya + tread, zt, M.deck);
    /* street view shows open risers — draw the riser board only if closed */
    if (!C.openRiser) BX(stairX0, ya + tread - 0.14, zt, stairX1, ya + tread, zt + riser, M.deck);
  }
  /* handrail follows the nosing line, so it is a sloped bar, not a stack */
  RMP(stairX1 - rt, stairX1, stairY0, stairY1, 3.0 - (nRise - 1) * riser, 3.0, 0.14, M.rail);
  for (let k = 0; k <= nRise - 1; k += 4)
    BX(stairX1 - rt*1.5, stairY1 - k * tread - rt*1.5, -k * riser, stairX1,
       stairY1 - k * tread, 3.0 - k * riser, M.rail);

  /* a pad at grade so the bottom step lands on something */
  GRP = 'structure';
  BX(stairX0 - 1.5, stairY0 - 3.5, -ff - 0.35,
     stairX1 + 1.5, stairY0 + 1, -ff, M.deck);

  /* the adjacent unit, east of the flight. Street view shows this stair in
     a slot between two units — without the neighbour it reads as a private
     stoop bolted to a free-standing building.

     Culled whenever the camera is outboard of it, the same doll's-house rule
     the exterior walls use: it is context, and context must never hide the
     thing it is giving context to. From the default iso you are looking down
     the slot, so it drops out and the flight stays visible. */
  const nbrVisible = C.neighbour && !EXPORTING &&
        (C.mirror ? eye()[0] > mSpan(nbrX, nbrX)[0] : eye()[0] < nbrX);
  if (nbrVisible) {
    GRP = 'neighbour';
    const h = wallTop(), y0 = landY0 - 2, y1 = landY1 + 2;
    BX(nbrX, y0, -ff, nbrX + C.wallExt, y1, h, M.poche);
    BX(nbrX, y0, -ff, nbrX + 3.5, y0 + C.wallExt, h, M.poche);   // return, north
    BX(nbrX, y1 - C.wallExt, -ff, nbrX + 3.5, y1, h, M.poche);   // return, south
  }
}

/* Guards read as solid panels on this building, not balusters. Same call
   either way so the balcony and the landing stay consistent. */
function guard(x0, y0, x1, y1, hgt) {
  if (C.solidGuard) { BX(x0, y0, 0, x1, y1, hgt, M.rail); return; }
  BX(x0, y0, hgt - 0.14, x1, y1, hgt, M.rail);               // top rail
  BX(x0, y0, 0, x1, y1, 0.12, M.rail);                       // bottom rail
}

/* ══ casework — derived from the room rectangles ═══════════════════ */
function fixturesA101(C, G) {
  const { rooms: R } = G, cd = C.counterD, ch = C.counterH, ct = 0.13;
  /* casework is authored in A-101 coordinates and reflected on the way out,
     same as the walls — so the sink stays 60% along the run from the same
     end of the kitchen, and lands on the mirrored side of the unit */
  const box = BX;
  const fx = (a,b,c2,d) => { const s = mSpan(a,c2); blockers.push([s[0],b,s[1],d]); };

  /* ── kitchen: a galley running east–west. The north run is the bar — it
        carries on past the end of the wall to make the pass-through. The
        aisle is bathD − 2 × 25″, which the Fit tab grades. ── */
  GRP = 'kitchen';
  const [kx0, ky0, kx1, ky1] = R.kitchen, kw = kx1 - kx0;
  for (const north of [true, false]) {
    const y0 = north ? ky0 : ky1 - cd, y1 = north ? ky0 + cd : ky1;
    box(kx0, y0, 0, kx1, y1, ch - ct, M.cab);
    box(kx0, y0 - (north?0:.04), ch - ct, kx1, y1 + (north?.04:0), ch, M.counter);
    fx(kx0, y0, kx1, y1);
    /* uppers only on the south run — the bar's north side is the pass-through
       and the wall behind it stops short of the bar's east end */
    if (wallMode === 'full' && !north)
      box(kx0 + 1, ky1 - cd*0.55, C.upperStart, kx1 - 1, ky1, C.upperStart + C.upperH, M.cab);
  }
  // sink in the bar, cooktop in the south run, fridge at the south run's west end
  const sc = kx0 + kw*0.52;
  box(sc - 1.1, ky0 + .28, ch - .45, sc + 1.1, ky0 + cd - .3, ch - ct, M.appl);
  const rc = kx0 + kw*0.73;
  box(rc - 1.25, ky1 - cd, ch - ct, rc + 1.25, ky1, ch + .03, M.appl);
  box(kx0, ky1 - 2.6, 0, kx0 + 2.5, ky1, 6.1, M.appl);  fx(kx0, ky1 - 2.6, kx0 + 2.5, ky1);

  /* ── bathroom, as this sheet arranges it: a 5′-0″ × 8′-0″ run with the tub
        across the full width at the south end, then toilet, then sink. The
        5′-0″ width finally takes a full-length alcove tub — the previous
        sheet could only fit 4′-6″. ── */
  GRP = 'bath';
  const [bx0, by0, bx1, by1] = R.bath;
  const tubD = 2.5;
  box(bx0, by1 - tubD, 0, bx1, by1, 1.6, M.porc);
  box(bx0 + .18, by1 - tubD + .18, 1.25, bx1 - .18, by1 - .18, 1.62, M.tile);
  fx(bx0, by1 - tubD, bx1, by1);
  // toilet in the middle, tank against the west wall
  box(bx0, by1 - 4.5, 0, bx0 + .65, by1 - 3.4, 2.4, M.porc);
  box(bx0 + .65, by1 - 4.4, 0, bx0 + 1.85, by1 - 3.5, 1.3, M.porc);
  fx(bx0, by1 - 4.5, bx0 + 1.85, by1 - 3.4);
  // vanity at the north end, against the west wall
  box(bx0, by0 + .2, 0, bx0 + 2.1, by0 + 2.4, 2.7, M.cab);
  box(bx0, by0 + .15, 2.7, bx0 + 2.2, by0 + 2.5, 2.85, M.counter);
  fx(bx0, by0 + .2, bx0 + 2.1, by0 + 2.4);

  /* ── stacked washer / dryer, in its alcove off the vestibule ── */
  GRP = 'laundry';
  const [wx0, wy0, wx1, wy1] = R.wd;
  box(wx0 + .15, wy0 + .15, 0, wx1 - .15, wy1 - .15, 6.0, M.appl);
  fx(wx0 + .15, wy0 + .15, wx1 - .15, wy1 - .15);

  /* ── closet rods (visual only, no blocking) ── */
  GRP = 'closets';
  const rod = (r, along) => {
    const my = (r[1]+r[3])/2, mx = (r[0]+r[2])/2;
    if (along === 'x') box(r[0] + .3, my - .05, 5.4, r[2] - .3, my + .05, 5.5, M.metal);
    else               box(mx - .05, r[1] + .3, 5.4, mx + .05, r[3] - .3, 5.5, M.metal);
  };
  rod(R.closet, 'x'); rod(R.coat, 'x');
  /* ── storage closet off the balcony: shelving ── */
  const [sx0, sy0, sx1, sy1] = R.storage;
  for (const z of [1.6, 3.2, 4.8]) box(sx0 + .2, sy0 + .25, z, sx1 - .2, sy1 - .25, z + .08, M.cab);
}

/* ── registry entry ─────────────────────────────────────────────── */
PLANS.push({
  id: 'goldridge', rev: 'v4', legacy: true,
  name: 'Goldridge Apartments', tag: '650 sq ft', sub: 'Field-measured · second storey',
  PLAN: PLAN_A101, derive: deriveA101, problems: problemsA101,
  shell: shellA101, fixtures: fixturesA101,
  handed: true,

  rooms: (C, G) => [
    ['Bedroom', G.rooms.bedroom, 1], ['Living', G.rooms.living, 1],
    ['Dining', G.rooms.dining, 1], ['Kitchen', G.rooms.kitchen, 1],
    ['Bath', G.rooms.bath, 1], ['Vestibule', G.rooms.vest, 0],
    ['W/D', G.rooms.wd, 0], ['Closet', G.rooms.closet, 0],
    ['Coat', G.rooms.coat, 0], ['Storage', G.rooms.storage, 0],
    ['Balcony', G.balcony, 1],
  ],
  scheduled: ['Living', 'Dining', 'Kitchen', 'Bedroom', 'Bath'],
  footprint: C => [[0, 0, C.W, C.D]],
  areaExtras: (C, G) => [
    ['Balcony', `${ftin(C.balcW)} × ${ftin(C.balcD)}`, G.balcony],
    ['Storage', `${ftin(C.storW)} × ${ftin(C.storD)}`, G.rooms.storage],
    ['Coat closet', `${ftin(C.storW)} × ${ftin(G.coatD)}`, G.rooms.coat],
  ],
  envelope: C => `${ftin(C.W)} × ${ftin(C.D)}`,
  /* the closet stack at the east end of the bump-out is enclosed but sits
     outside the envelope, so gross building area has to pick it up */
  bumpGross: (C, G) => (C.storW + C.wallInt + C.wallExt) * (C.balcD + C.wallExt),
  pad: C => Math.max(2, C.balcD + C.wallExt + 1),
  seal: (C, G, stamp, PAD) => {
    const e = C.wallExt, bo = C.balcD + e;
    stamp([-PAD, -PAD, C.W + PAD, -bo]);              // north of the bump-out
    stamp([-PAD, C.D + e, C.W + PAD, C.D + PAD]);     // south
    stamp([-PAD, -PAD, -e, C.D + PAD]);               // west
    stamp([C.W + e, -PAD, C.W + PAD, C.D + PAD]);     // east
    stamp(mRect([-PAD, -bo, G.balcX - e, -e]));       // outdoors beside the bump-out
  },
  routes: (C, G) => [
    ['Living', G.rooms.living], ['Dining', G.rooms.dining],
    ['Kitchen', G.rooms.kitchen], ['Bathroom', G.rooms.bath],
    ['Bedroom', [G.rooms.bedroom[0], G.rooms.bedroom[1], G.rooms.bedroom[2], G.cy]],
    ['Balcony', G.balcony],
  ],
  entryProbe: (C, G) => [C.W - 2.2, G.op.entry[0], C.W - 0.1, G.op.entry[1]],
  /* the one piece of floor outside the envelope you may still stand furniture
     on. inBounds() needs this per-plan: it used to read G.balcony directly,
     which is a key only this plan defines. */
  outdoor: (C, G) => G.balcony,
  seedRect: (C, G, grp) =>
    grp === 'Bedroom' ? [G.rooms.bedroom[0], G.rooms.bedroom[1], G.rooms.bedroom[2], G.cy]
    : grp === 'Dining' ? G.rooms.dining
    : grp === 'Balcony' ? G.balcony
    : G.rooms.living,
  keepOut: (C, G) => {
    const m = C.clearMain || 3, e = G.op.entry;
    return [
      [C.W - m - 1, e[0] - 0.5, C.W, e[1] + 0.5],
      [G.rooms.vest[0], G.rooms.vest[1], G.rooms.vest[2] + m, G.rooms.vest[3]],
      [G.op.bedDoor[0] - 0.5, C.bedD, G.op.bedDoor[1] + 0.5, C.bedD + m],
      [G.op.slider[0], 0, G.op.slider[1], m],
    ];
  },
  derived: (C, G) => [
    ['Living width', G.livW, 'W − bedW − 4″'],
    ['Dining width', G.dinW, 'W − bathW − 4″ − kitW'],
    ['Dining depth', G.dinD, 'D − livD'],
    ['Hallway depth', G.utilD, 'D − bedD − bathD − 8″'],
    ['Hallway length', C.bedW - C.wdW, 'bedW − wdW'],
    ['Coat closet depth', G.coatD, 'balcD − 8″ − 4″ − storD'],
    ['Bump-out width', G.bumpW, 'balcW + 4″ + storW'],
    ['Galley aisle', (C.bathD - 2 * C.counterD), 'bathD − 2 × 25″'],
    ['Riser', G.riser, 'floorToFloor ÷ risers, capped at 7½″'],
    ['Stair run', G.run, '(risers − 1) × tread'],
  ],
  fit: (C, G, R, grade) => {
    const aisle = (C.bathD - 2 * C.counterD) * 12;
    const aisleState = aisle < 42 ? 'fail' : aisle > 56 ? 'fail' : aisle > 48 ? 'tight' : 'pass';
    const ri = G.riser * 12, tr = C.tread * 12, blondel = 2 * ri + tr;
    /* What the tape actually read, in inches, kept so the two hallway numbers
       can be graded against it — both of them derive, so they are where the
       accumulated slop in a 23-foot chain of measurements comes out. */
    const TAPE = { hallD: 38, hallL: 105, livW: 155, dinW: 102 };
    const resid = (derivedFt, taped) => Math.round(derivedFt * 12 - taped);
    const slop = n => Math.abs(n) <= 2 ? 'pass' : Math.abs(n) <= 6 ? 'tight' : 'fail';
    const dHallD = resid(G.utilD, TAPE.hallD), dHallL = resid(C.bedW - C.wdW, TAPE.hallL);
    const dLivW = resid(G.livW, TAPE.livW), dDinW = resid(G.dinW, TAPE.dinW);
    return [
      { title: 'Against the tape', rows: [
        /* W is measured twice over, by two disjoint sets of rooms — bedroom +
           living across the north, bathroom + kitchen + dining across the
           south. Both bands derive their spare room from W, so these two rows
           are how you find out that W itself is wrong. */
        R('Width closes, north band', `${ftin(G.livW)} living vs ${TAPE.livW}″ taped`, slop(dLivW),
          `livW = W − bedW − 4″. Off by ${dLivW > 0 ? '+' : ''}${dLivW}″ means W disagrees with the taped bedroom + living room.`),
        R('Width closes, south band', `${ftin(G.dinW)} dining vs ${TAPE.dinW}″ taped`, slop(dDinW),
          `dinW = W − bathW − 4″ − kitW. This is the row that moves when a real bathroom measurement goes in: off by ${dDinW > 0 ? '+' : ''}${dDinW}″ means the bathroom and W cannot both be right.`),
        R('Hallway depth', `${ftin(G.utilD)} vs ${TAPE.hallD}″ taped`, slop(dHallD),
          `Derives from D − bedD − bathD − 8″, so it collects the error from every reading above it. Out by ${dHallD > 0 ? '+' : ''}${dHallD}″.`),
        R('Hallway length', `${ftin(C.bedW - C.wdW)} vs ${TAPE.hallL}″ taped`, slop(dHallL),
          `Derives from bedW − wdW. wdW was set to make this land, so this agreeing proves nothing — it is the W/D alcove that is unverified.`),
        R('Bathroom', `${ftin(C.bathW)} × ${ftin(C.bathD)}`, 'tight',
          `Never measured — but not free either. ${ftin(C.bathW)} is the ONLY width at which the south band spans the same W as the taped bedroom + living room, so it is a prediction, not a guess. Measure it: if it comes back near ${ftin(C.bathW)} that independently confirms W from a disjoint set of rooms. If it comes back very different, the two width rows above go red and W is wrong — or the south band holds something unmeasured, a chase or a linen closet.`),
        R('Balcony clears the bedroom', ftin(G.balcX - C.bedW),
          G.balcX - C.bedW >= 1 ? 'pass' : G.balcX - C.bedW >= 0 ? 'tight' : 'fail',
          `The bump-out has to start east of the bedroom's party wall or the balcony would open off the bedroom. At the taped width it clears by ${ftin(G.balcX - C.bedW)} — it used to clear by 2′-0″, so the storage and coat closets are the next thing the tape will move.`),
      ]},
      { title: 'Built in — from the dimensions', rows: [
        R('Galley aisle', Math.round(aisle) + '″', aisleState,
          aisle > 56 ? `Too wide to be a galley. kitD derives to ${ftin(G.kitD)} from bathD + 4″, so the runs end up ${Math.round(aisle)}″ apart — that's a corridor kitchen, not a galley.`
          : aisle < 42 ? `Below the 42″ rule — two people cannot pass, and an open oven door blocks the opposite run. A-101 draws the kitchen ${ftin(G.kitD)} deep with counters on both long walls.` : ''),
      ]},
      { title: `Entry stair — ${G.nRise} risers`, rows: [
        R('Riser height', ri.toFixed(2) + '″', ri <= 7.75 ? (ri <= 7.25 ? 'pass' : 'tight') : 'fail',
          ri > 7.75 ? 'Over the 7¾″ maximum. Add a riser, or drop the floor height.' : ''),
        R('Tread depth', tr.toFixed(2) + '″', tr >= 11 ? 'pass' : tr >= 10 ? 'tight' : 'fail',
          tr < 10 ? 'Under the 10″ minimum tread.' : ''),
        R('2 × riser + tread', blondel.toFixed(1) + '″',
          blondel >= 24 && blondel <= 25 ? 'pass' : blondel >= 22 && blondel <= 26 ? 'tight' : 'fail',
          (blondel < 22 || blondel > 26) ? 'Outside 24–25″. The flight will not walk at a natural stride.' : ''),
        R('Flight fits the walkway', `${ftin(G.run)} of ${ftin(G.landY1 - G.landY0)}`,
          G.run <= G.landY1 - G.landY0 ? 'pass' : 'fail',
          G.run > G.landY1 - G.landY0 ? `The flight is longer than the deck it drops through by ${ftin(G.run - (G.landY1 - G.landY0))} — raise the riser count or shorten the tread.` : ''),
        R('Pass strip beside the stairwell', ftin(C.landD - C.stairW),
          C.landD - C.stairW >= 3 ? 'pass' : C.landD - C.stairW >= 2.5 ? 'tight' : 'fail',
          C.landD - C.stairW < 3 ? 'Under 36″ — you cannot get past the stairwell to the next door. Deepen the walkway or narrow the flight.' : ''),
        R('Walkway depth', ftin(C.landD), C.landD >= 3 ? 'pass' : 'fail',
          C.landD < 3 ? 'Under 36″ — the door cannot swing clear of the stair.' : ''),
        R('Guard height', ftin(C.guardH), C.guardH >= 3.5 ? 'pass' : 'fail',
          `${C.solidGuard ? 'Solid panel' : 'Open rail'}, ${C.openRiser ? 'open' : 'closed'} risers — both read off the street view rather than the sheet.`),
      ]},
    ];
  },
  areaNote: (C, G, A) => `The listed 650 sf is a GROSS BUILDING figure and the tape agrees with it: measured to the outside face of the exterior walls, and picking up the closet stack in the bump-out, this plan is ${A.grossExt.toFixed(0)} sf — within ${Math.abs(650 - A.grossExt).toFixed(0)} sf of the listing. Nothing is missing. Inside those walls you get ${A.gross.toFixed(0)} sf of interior and ${A.net.toFixed(0)} sf of actual floor, because ${(A.grossExt - A.net).toFixed(0)} sf of the 650 is wall: ${(2*(C.W + C.D)*C.wallExt + 4*C.wallExt*C.wallExt).toFixed(0)} sf of 8″ exterior envelope, ${(A.gross - A.net).toFixed(0)} sf of partitions, and the bump-out closets. A small unit has a lot of perimeter for its area, so that ratio is normal — but furniture goes in the ${A.net.toFixed(0)} sf, which is the number to shop against.`,
  resetLabel: 'the tape survey',
  constants: `Near-certain in US residential. Interior partitions 4″, exterior 8″. Interior doors 32″×80″, entry and bedroom 36″×80″, bypass/bifold 30″. Counters 36″ high × 25″ deep, uppers at 54″.`,
  fields: [
    { t: 'Envelope & rooms — field-measured',
      note: `Tape survey of 2026-08-01, which supersedes sheet A-101. W and D are not
             independent readings: W is bedW + 4″ + the living-room width, D is the living
             room plus the dining room. Measure the two overall runs directly and these are
             the first numbers to correct. bathW is the one room here nobody has measured.`,
      rows: [['W','Interior width'], ['D','Interior depth'], ['ceiling','Ceiling height'],
             ['bedW','Bedroom width'], ['bedD','Bedroom depth'],
             ['livD','Living-room depth'], ['partyD','Living/bedroom wall'],
             ['bathW','Bathroom width — unmeasured'], ['bathD','Bath + kitchen depth'],
             ['kitW','Kitchen run']] },
    { t: 'Closets & balcony',
      note: `The reach-in and the balcony are taped. The W/D alcove is set so the hallway
             derives to the 8′-9″ measured; the two bump-out closets are still off the sheet.`,
      rows: [['wdW','W/D alcove width'], ['closW','Reach-in width'], ['closD','Reach-in depth'],
             ['balcW','Balcony width'], ['balcD','Balcony depth'],
             ['storW','Storage width'], ['storD','Storage depth'],
             ['winX','Window from west'], ['winW','Window width']] },
    { t: 'Entry landing & stair',
      note: `Second-storey unit on a shared walkway. Riser count and run solve from the floor height.`,
      rows: [['floorToFloor','Floor above grade'], ['landD','Walkway depth'],
             ['landW','Walkway run past the door'], ['stairW','Stair width'],
             ['tread','Tread run'], ['guardH','Guard height']] },
  ],
});

/* ══════════════════════════════════════════════════════════════════
   HAZEL RANCH — 1 bed / 1 bath, 616 sq ft, Fair Oaks CA

   Recovered from the leasing floor plan (hazel-ranch-fair-oaks-ca-
   floorplan, an AVIF file despite the .jpg name). The drawing carries no
   dimension strings apart from three room callouts, so the scale was
   recovered from the drawing itself: wall centrelines were extracted at
   the pixel level and fitted, giving 35.5 px/ft across and 35.3 down —
   the half-percent between the axes is the sheet's own slop. Three
   independent checks agree with that scale: it makes the bedroom exactly
   the 10′-1″ its callout claims and the dining 8′-6″; it puts the walls
   at 7.6″ and 4.2″, which is 2×6 and 2×4 framing; and it makes the drawn
   interior 624 sf gross and 609 sf net of partitions, so the listing's
   616 sf sits between the two the way a listing figure does.

   Every wall in this module was checked by projecting the model's own
   footprints back onto the drawing. They register to within about 4″,
   which is the distance the sheet disagrees with itself by — it draws
   the bedroom's north wall and the living room's north wall, which are
   the same wall, 3½″ apart.

   The three room callouts are usable-area figures, not wall-to-wall:
   each one's SECOND number matches the drawn width to within 3″, while
   the first is short of the drawn depth (the living room's "9′-3″"
   measures the north part of a 15′-4″ deep band). The model reports the
   rectangles it actually draws.

   Two deliberate departures from the sheet, both noted in the Fit tab:
     · the slider is drawn 1′-7″ south of the living room's north wall,
       which would leave the patio deck notched around it. Modelled in
       line with the wall, which makes the patio the clean 12′ × 6′-3″
       rectangle the rest of the drawing implies.
     · door openings scale to 22–31″, narrower than anything that could
       be hung. Set to standard leaf sizes, since the whole point of the
       model is whether furniture gets through them.

   Ground floor: a patio with its own storage closet, no entry stair.
   ══════════════════════════════════════════════════════════════════ */
const PLAN_HAZEL = {
  /* ── envelope. An L: the main block, plus a dining bay stepping west
        at the south end. Origin is the interior NW corner of the
        bounding box, so the notch north of the dining bay is outdoors. ── */
  W:      27 + 4/12,        // interior width,  west→east   · 27′-4″
  D:      25 + 4/12,        // interior depth, north→south   · 25′-4″
  ceiling: 8,
  livX:    4,               // living room's west face = width of the dining bay
  dinD:    8 + 2/12,        // dining bay depth, up from the south wall

  /* ── east band: bedroom over hall over bath ── */
  bedW:   10 + 1/12,        // bedroom = bath width         · 10′-1″
  bedD:   11 + 4/12,        //   bedroom depth              × 11′-4″
  bathD:   5 + 6/12,        // bathroom depth               ·  5′-6″

  /* ── kitchen: a U open to the dining room round a peninsula ── */
  kitW:    8 + 3/12,        // kitchen width                ·  8′-3″
  kitD:    9 + 8/12,        //   depth                      ×  9′-8″
  kitOpen: 3 + 3/12,        // the way in, north of the peninsula

  /* ── hall closets. hallW is what is left of bedW once these are taken ── */
  cl1W:    1 + 9/12,        // linen closet, bypass doors
  cl2W:    4 + 1/12,        // bedroom closet — deep enough for a stacked W/D
  whD:     1 + 9/12,        // water-heater closet, under the linen closet

  /* ── living room north wall: shelving, then the fireplace, then glass ── */
  nicheW:  3 + 4/12,        // built-in shelving beside the fireplace
  nicheD:  1,
  fpW:     3 + 10/12,       // fireplace width
  fpD:     2 + 1/12,        //   projection into the room

  /* ── the patio bump-out, north ── */
  patW:   12,               // patio deck                   · 12′-0″
  patD:    6 + 3/12,        //   wall to fence              ×  6′-3″
  storW:   2 + 2/12,        // storage closet off the patio ·  2′-2″
  guardH:  5.5, solidGuard: true,   // ground-floor patio: a solid fence, not a rail

  /* ── glazing and the front door, off the west elevation ── */
  winY:    6.75, winW: 3.5,     // living room window, down from the north wall
  win2Y:  17.75, winW2: 3,      // dining window
  winSill: 2.5, winHead: 6 + 8/12,
  entryY: 11 + 8/12,            // front door, down from the north wall

  mirror: false,                // handing unknown — the drawing is one hand

  /* ── near-certain US residential constants. The drawing scales to
        7.6″ exterior and 4.2″ partitions, which is 2×6 and 2×4 framing. ── */
  wallInt: 4/12, wallExt: 8/12,
  doorInt:  32/12, doorEntry: 36/12, doorH: 80/12,
  bypass: 4/12,
  counterH: 36/12, counterD: 25/12, upperStart: 54/12, upperH: 30/12,
};

/* ══ derivation ═══════════════════════════════════════════════════
   The tiling identities for this plan:
       partX  = W − bedW − wallInt          (the two bands must sum to W)
       hallW  = bedW − 2·wallInt − cl1W − cl2W   (hall is what the closets leave)
       cl1D   = hallD − whD − wallInt       (linen closet stacks on the WH closet)
       fpX    = livX + nicheW               (shelving butts the fireplace)
       patX   = fpX + wallExt               (patio wall lines up with the chase)
       sliderW= partX − fpX − fpW           (glass fills fireplace → partition)
   The last one is not a convenience: on the sheet the slider runs from the
   fireplace's east face to the bedroom partition exactly, so it is the
   opening that has to absorb any change to the fireplace or the bedroom.
   ══════════════════════════════════════════════════════════════════ */
function deriveHazel(c) {
  const { W, D, livX, dinD, bedW, bedD, bathD, kitW, kitD, kitOpen,
          cl1W, cl2W, whD, nicheW, fpW, patW, patD, storW,
          wallInt: i, wallExt: e } = c;

  const partX = W - bedW - i;        // living/kitchen east face
  const partE = partX + i;           // bedroom/bath west face
  const kx    = partX - kitW;        // kitchen west face
  const ky    = D - kitD;            // kitchen north wall, interior face
  const dy    = D - dinD;            // dining bay, north interior face

  const hallD = D - bedD - bathD - 2*i;   // the hall band is the remainder
  const hy0   = bedD + i;            //   north face
  const hy1   = hy0 + hallD;         //   south face
  const by    = hy1 + i;             // bath north interior face
  const hallW = bedW - 2*i - cl1W - cl2W;
  const c1x   = partE + hallW + i;   // linen closet west face
  const c2x   = c1x + cl1W + i;      // bedroom closet west face
  const cl1D  = hallD - whD - i;     // linen closet depth
  const wy    = hy0 + cl1D + i;      // water-heater closet north face

  const fpX   = livX + nicheW;       // fireplace west face
  const patX  = fpX + e;             // patio deck west face
  const sliderW = partX - fpX - fpW;
  const stoX  = patX + patW + e;     // storage closet west face
  const bumpE = stoX + storW;        //   east face
  const py0   = -(patD + e);         // bump-out north interior face
  const py1   = -e;                  //   south face = north wall's outer face
  const peny  = ky + kitOpen;        // peninsula north end

  return {
    partX, partE, kx, ky, dy, hallD, hy0, hy1, by, hallW, c1x, c2x, cl1D, wy,
    fpX, patX, sliderW, stoX, bumpE, py0, py1, peny,
    rooms: {
      living:  [livX, 0, partX, ky],
      kitchen: [kx, ky, partX, D],
      dining:  [0, dy, kx, D],
      bedroom: [partE, 0, W, bedD],
      hall:    [partE, hy0, partE + hallW, hy1],
      linen:   [c1x, hy0, c1x + cl1W, hy0 + cl1D],
      water:   [c1x, wy, c2x, hy1],
      closet:  [c2x, hy0, W, hy1],
      bath:    [partE, by, W, D],
      storage: [stoX, py0, bumpE, py1],
    },
    patio: [patX, py0, patX + patW, py1],
    /* openings, each against the wall it sits in */
    op: {
      slider:   [fpX + fpW, partX],                       // north wall
      window:   [c.winY, c.winY + c.winW],                // west wall (a Y-range)
      window2:  [c.win2Y, c.win2Y + c.winW2],             // dining bay west wall
      entry:    [c.entryY, c.entryY + c.doorEntry],       // west wall (a Y-range)
      /* centred in the hall so the leaf swings clear of both closets */
      bedDoor:  [partE + hallW/2 - c.doorInt/2, partE + hallW/2 + c.doorInt/2],
      /* the bedroom closet, in the same wall, centred on its own width */
      closDoor: [c2x + (W - c2x)/2 - c.doorInt/2, c2x + (W - c2x)/2 + c.doorInt/2],
      bathDoor: [partE + 0.5, partE + 0.5 + c.doorInt],   // bath north wall
      linenDoor:[hy0 + 0.25, hy0 + cl1D - 0.25],          // bypass, near full width
      whDoor:   [wy + 0.15, hy1 - 0.15],
      storDoor: [py0 + (patD - 2.75)/2, py0 + (patD + 2.75)/2],
    },
  };
}

function problemsHazel(c, g) {
  const p = [];
  if (g.sliderW <= 3) p.push(`Slider derives to ${ftin(g.sliderW)} — the fireplace and the bedroom
    have eaten the glass. Narrow the fireplace or the bedroom.`);
  if (g.hallW <= 2.5) p.push(`Hall derives to ${ftin(g.hallW)} — the two closets have taken the
    whole band. There is no way through to the bathroom.`);
  if (g.cl1D <= 1) p.push(`Linen closet derives to ${ftin(g.cl1D)} — the water heater fills the stack.`);
  if (g.kx <= c.livX) p.push('Kitchen runs past the living room into the dining bay.');
  if (g.ky <= c.bedD) p.push('Kitchen depth overruns the bedroom band — the hall mouth closes up.');
  if (g.dy <= g.ky) p.push('Dining bay is deeper than the kitchen band — the step wall lands in the kitchen.');
  if (c.entryY + c.doorEntry > g.dy) p.push('Front door runs past the living room into the dining step.');
  if (c.winY + c.winW > c.entryY) p.push('Living room window overlaps the front door.');
  if (g.fpX + c.fpW > g.partX) p.push('Fireplace runs past the bedroom partition.');
  return p;
}

function shellHazel(C, G, h) {
  const { W, D, wallExt: e, wallInt: i, doorH: dh, livX, patD, storW,
          bedD, fpW, fpD, nicheD, nicheW } = C;
  const { rooms: R, patio: P, op, partX, partE, kx, ky, dy, hy0, hy1, by,
          c1x, c2x, cl1D, wy, fpX, patX, stoX, bumpE, py0, py1, peny } = G;

  /* floors — the L is two rectangles; the notch north of the dining bay
     is outdoors and deliberately gets no floor */
  GRP = 'floor';
  FQ(livX, 0, W, D, 0, M.oak);
  FQ(0, dy, livX, D, 0, M.oak);
  FQ(R.kitchen[0], R.kitchen[1], R.kitchen[2], R.kitchen[3], .03, M.tile);
  FQ(R.bath[0], R.bath[1], R.bath[2], R.bath[3], .03, M.tile);
  /* patio slab, plus the storage closet floor at its east end */
  BX(P[0], P[1], -0.34, P[2], P[3], 0, M.deck, null, floorQuads);
  FQ(stoX, py0, bumpE, py1, 0, M.oak);

  /* exterior — doll's-house culling at full height, never while exporting */
  GRP = 'walls';
  const ep = eye(), cull = wallMode === 'full' && !EXPORTING;
  const camEntry = C.mirror ? ep[0] > W : ep[0] < 0;      // the entry is WEST as drawn
  const camFar   = C.mirror ? ep[0] < 0 : ep[0] > W;
  GHOST = cull && ep[1] < 0;
  /* north wall: carries the slider onto the patio. The fireplace sits in
     this wall too, but as a solid mass rather than an opening. */
  WX(livX - e, W + e, -e, 0, 0, h, [[op.slider[0], op.slider[1], 0, dh]], M.wall);
  GHOST = cull && ep[1] > D;
  WX(-e, W + e, D, D + e, 0, h, [], M.wall);
  GHOST = cull && camEntry;
  // west wall of the living room — front door and the living room window
  WY(-e, dy, livX - e, livX, 0, h, [
      [op.entry[0],  op.entry[1],  0, dh],
      [op.window[0], op.window[1], C.winSill, C.winHead]], M.wall);
  // the dining bay: its own west wall, and the step that returns to the living room
  WY(dy - e, D + e, -e, 0, 0, h,
     [[op.window2[0], op.window2[1], C.winSill, C.winHead]], M.wall);
  GHOST = cull && ep[1] < dy;
  WX(-e, livX, dy - e, dy, 0, h, [], M.wall);
  GHOST = cull && camFar;
  WY(-e, D + e, W, W + e, 0, h, [], M.wall);
  GHOST = false;

  /* ── glazing, clamped to the current wall top so it cuts with the walls ── */
  GRP = 'glazing';
  const gz = z => Math.min(z, h);
  const winY = (a, b, x0) => { if (gz(C.winHead) > C.winSill)
    BX(x0 - e*0.6, a, C.winSill, x0 - e*0.4, b, gz(C.winHead), M.glass); };
  winY(op.window[0],  op.window[1],  livX);
  winY(op.window2[0], op.window2[1], 0);

  /* sliding glass door — two leaves in two tracks, the outboard one fixed */
  const [sa, sb] = op.slider, sw = (sb - sa) / 2, ft = 0.12;
  const leaf = (x0, x1, yc) => {
    const top = gz(dh); if (top <= 0.12) return;
    BX(x0, yc - .03, .12, x1, yc + .03, top - .08, M.glass);
    BX(x0, yc - .05, .12, x0 + ft, yc + .05, top, M.rail);
    BX(x1 - ft, yc - .05, .12, x1, yc + .05, top, M.rail);
    BX(x0, yc - .05, 0, x1, yc + .05, .12, M.rail);
    if (top >= dh - .01) BX(x0, yc - .05, top - .08, x1, yc + .05, top, M.rail);
  };
  leaf(sa, sa + sw, -e * 0.72);
  leaf(sa + sw, sb, -e * 0.32);

  /* ── patio bump-out: three walls, a divider carrying the storage door,
        and a solid fence across the open north edge ── */
  GRP = 'walls';
  WX(patX - e, bumpE + e, py0 - e, py0, 0, h, [], M.wall);   // north
  WY(py0 - e, py1, patX - e, patX, 0, h, [], M.wall);        // west
  WY(py0 - e, py1, bumpE, bumpE + e, 0, h, [], M.wall);      // east
  WY(py0, py1, stoX - e, stoX, 0, h,
     [[op.storDoor[0], op.storDoor[1], 0, dh]], M.wall);     // patio | storage

  /* ── interior partitions ── */
  // bedroom west wall, then the hall mouth, then kitchen east / bath west
  WY(0, bedD, partX, partE, 0, h, [], M.wall);
  WY(ky, D, partX, partE, 0, h, [], M.wall);
  /* kitchen north wall — solid all the way to the partition. The kitchen is
     entered from the dining room at its west end, past the peninsula, not
     from the living room, which is why this wall carries no opening. */
  WX(kx, partX, ky - i, ky, 0, h, [], M.wall);
  // bedroom south wall — bedroom door and the closet door open off the hall
  WX(partX, W + e, bedD, hy0, 0, h, [
      [op.bedDoor[0],  op.bedDoor[1],  0, dh],
      [op.closDoor[0], op.closDoor[1], 0, dh]], M.wall);
  // hall east wall: linen bypass above, water-heater door below
  WY(hy0, hy1, c1x - i, c1x, 0, h, [
      [op.linenDoor[0], op.linenDoor[1], 0, dh],
      [op.whDoor[0],    op.whDoor[1],    0, dh]], M.wall);
  // bedroom closet west wall, full depth of the band
  WY(hy0, hy1, c2x - i, c2x, 0, h, [], M.wall);
  // linen closet floor plate — the wall between it and the water heater
  WX(c1x - i, c2x, wy - i, wy, 0, h, [], M.wall);
  // bath north wall
  WX(partX, W + e, hy1, by, 0, h, [[op.bathDoor[0], op.bathDoor[1], 0, dh]], M.wall);

  /* ── the fireplace: a masonry mass in the north wall, projecting into
        the living room, with the firebox recessed in its south face ── */
  GRP = 'fireplace';
  const fb = 0.5;                                    // firebox inset from the ends
  BX(fpX, 0, 0, fpX + fb, fpD, h, M.poche);          // west cheek
  BX(fpX + fpW - fb, 0, 0, fpX + fpW, fpD, h, M.poche);   // east cheek
  BX(fpX + fb, 0, 0, fpX + fpW - fb, fpD * 0.42, h, M.poche);  // back of the box
  BX(fpX + fb, fpD * 0.42, 3.1, fpX + fpW - fb, fpD, h, M.poche);  // lintel over
  BX(fpX + fb, fpD * 0.42, 0, fpX + fpW - fb, fpD, 0.55, M.poche); // raised hearth
  blockers.push(mRect([fpX, 0, fpX + fpW, fpD]));

  /* ── the built-in shelving between the west wall and the chase ── */
  GRP = 'shelves';
  BX(livX, 0, 0, livX + nicheW, nicheD, 0.2, M.cab);
  BX(livX, 0, 6.4, livX + nicheW, nicheD, 6.6, M.cab);
  BX(livX, 0, 0, livX + 0.12, nicheD, 6.6, M.cab);
  BX(livX + nicheW - 0.12, 0, 0, livX + nicheW, nicheD, 6.6, M.cab);
  for (const z of [1.6, 3.0, 4.4, 5.6])
    BX(livX + 0.12, 0, z, livX + nicheW - 0.12, nicheD - 0.05, z + 0.08, M.cab);
  blockers.push(mRect([livX, 0, livX + nicheW, nicheD]));

  /* ── patio fence. Ground floor, so it is a 5′-6″ solid privacy fence
        across the north edge, not a 3′-6″ guard ── */
  GRP = 'railing';
  guard(P[0], P[1], P[2], P[1] + 0.3, C.guardH);

  buildStoop(C, G);
}

/* A ground-floor unit gets a doorstep, not a flight: a slab outside the
   front door wide enough to stand on with the door swinging in. */
function buildStoop(C, G) {
  GRP = 'landing';
  const e = C.wallExt, [a, b] = G.op.entry;
  BX(C.livX - e - 3.5, a - 1.2, -0.5, C.livX - e, b + 1.2, -0.02, M.deck);
  BX(C.livX - e - 3.5, a - 1.2, -0.02, C.livX - e - 3.3, b + 1.2, 0.12, M.deck);
}

function fixturesHazel(C, G) {
  const { rooms: R } = G, cd = C.counterD, ch = C.counterH, ct = 0.13;
  const box = BX;
  const fx = (a,b,c2,d) => { const s = mSpan(a,c2); blockers.push([s[0],b,s[1],d]); };

  /* ── kitchen: a U — east run against the partition, south run along the
        outside wall, and a peninsula returning north that both encloses
        the room and makes the bar the photos show. The way in is the
        kitOpen gap north of the peninsula. ── */
  GRP = 'kitchen';
  const [kx0, ky0, kx1, ky1] = R.kitchen;
  const run = (x0, y0, x1, y1) => {
    box(x0, y0, 0, x1, y1, ch - ct, M.cab);
    box(x0 - .04, y0 - .04, ch - ct, x1 + .04, y1 + .04, ch, M.counter);
    fx(x0, y0, x1, y1);
  };
  run(kx1 - cd, ky0, kx1, ky1);                        // east run
  run(kx0, ky1 - cd, kx1 - cd, ky1);                   // south run
  run(kx0, G.peny, kx0 + cd, ky1 - cd);                // peninsula
  /* the peninsula's north end is a short return wall — it is what the
     upper cabinets die into, and what makes the opening read as a door */
  box(kx0, G.peny - .34, 0, kx0 + cd, G.peny, ch + .55, M.cab);
  fx(kx0, G.peny - .34, kx0 + cd, G.peny);
  if (wallMode === 'full')
    box(kx1 - cd*0.55, ky0 + 1, C.upperStart, kx1, ky1 - cd - 0.6,
        C.upperStart + C.upperH, M.cab);
  // fridge at the north end of the east run, range mid-run, sink in the south
  box(kx1 - 2.5, ky0, 0, kx1, ky0 + 2.75, 6.1, M.appl);  fx(kx1 - 2.5, ky0, kx1, ky0 + 2.75);
  const rc = ky0 + (ky1 - ky0) * 0.58;
  box(kx1 - cd, rc - 1.25, ch - ct, kx1, rc + 1.25, ch + .03, M.appl);
  const sc = kx0 + (kx1 - cd - kx0) * 0.55;
  box(sc - 1.1, ky1 - cd + .3, ch - .45, sc + 1.1, ky1 - .28, ch - ct, M.appl);
  // dishwasher, in the peninsula beside the sink
  box(kx0 + .05, ky1 - cd - 2.1, 0, kx0 + cd, ky1 - cd - .1, ch - ct, M.appl);

  /* ── bathroom: vanity along the south wall at the west end, then the
        toilet, then a full-length tub against the east wall ── */
  GRP = 'bath';
  const [bx0, by0, bx1, by1] = R.bath;
  const tubW = 2.5;
  box(bx1 - tubW, by0 + 0.2, 0, bx1, by1, 1.6, M.porc);
  box(bx1 - tubW + .18, by0 + 0.38, 1.25, bx1 - .18, by1 - .18, 1.62, M.tile);
  fx(bx1 - tubW, by0 + 0.2, bx1, by1);
  // toilet, tank to the south wall
  box(bx1 - tubW - 1.3, by1 - .65, 0, bx1 - tubW - .2, by1, 2.4, M.porc);
  box(bx1 - tubW - 1.2, by1 - 1.85, 0, bx1 - tubW - .3, by1 - .65, 1.3, M.porc);
  fx(bx1 - tubW - 1.3, by1 - 1.85, bx1 - tubW - .2, by1);
  // vanity
  box(bx0 + .2, by1 - 1.8, 0, bx0 + 4.9, by1, 2.7, M.cab);
  box(bx0 + .15, by1 - 1.9, 2.7, bx0 + 5.0, by1, 2.85, M.counter);
  fx(bx0 + .2, by1 - 1.8, bx0 + 4.9, by1);

  /* ── water heater, in its closet under the linen shelves ── */
  GRP = 'laundry';
  const [wx0, wy0, wx1, wy1] = R.water;
  const wc = [(wx0 + wx1) / 2, (wy0 + wy1) / 2], wr = Math.min(0.85, (wy1 - wy0) / 2 - .1);
  box(wc[0] - wr, wc[1] - wr, 0, wc[0] + wr, wc[1] + wr, 4.8, M.appl);
  fx(wc[0] - wr, wc[1] - wr, wc[0] + wr, wc[1] + wr);

  /* ── closet rods and shelves (visual only, no blocking) ── */
  GRP = 'closets';
  const rod = (r, along) => {
    const my = (r[1]+r[3])/2, mx = (r[0]+r[2])/2;
    if (along === 'x') box(r[0] + .3, my - .05, 5.4, r[2] - .3, my + .05, 5.5, M.metal);
    else               box(mx - .05, r[1] + .3, 5.4, mx + .05, r[3] - .3, 5.5, M.metal);
  };
  rod(R.closet, 'y');
  for (const z of [1.4, 2.8, 4.2, 5.6])
    box(R.linen[0] + .1, R.linen[1] + .15, z, R.linen[2] - .1, R.linen[3] - .15, z + .08, M.cab);
  /* ── storage closet off the patio: shelving ── */
  const [sx0, sy0, sx1, sy1] = R.storage;
  for (const z of [1.6, 3.2, 4.8]) box(sx0 + .2, sy0 + .25, z, sx1 - .2, sy1 - .25, z + .08, M.cab);
}

/* ── registry entry ─────────────────────────────────────────────── */
PLANS.push({
  id: 'hazel', rev: 'v1',
  name: 'Hazel Ranch', tag: '616 sq ft', sub: 'Leasing plan · ground floor · Fair Oaks',
  PLAN: PLAN_HAZEL, derive: deriveHazel, problems: problemsHazel,
  shell: shellHazel, fixtures: fixturesHazel,
  handed: true,

  rooms: (C, G) => [
    ['Living', G.rooms.living, 1], ['Bedroom', G.rooms.bedroom, 1],
    ['Dining', G.rooms.dining, 1], ['Kitchen', G.rooms.kitchen, 1],
    ['Bath', G.rooms.bath, 1], ['Hall', G.rooms.hall, 0],
    ['Linen', G.rooms.linen, 0], ['W/H', G.rooms.water, 0],
    ['Closet', G.rooms.closet, 0], ['Storage', G.rooms.storage, 0],
    ['Patio', G.patio, 1],
  ],
  scheduled: ['Living', 'Dining', 'Kitchen', 'Bedroom', 'Bath'],
  /* the L — the notch north of the dining bay is outdoors and must not
     be counted as floor, which is why this is a list and not W × D */
  footprint: (C, G) => [[C.livX, 0, C.W, C.D], [0, G.dy, C.livX, C.D]],
  areaExtras: (C, G) => [
    ['Patio', `${ftin(C.patW)} × ${ftin(C.patD)}`, G.patio],
    ['Storage', `${ftin(C.storW)} × ${ftin(C.patD)}`, G.rooms.storage],
    ['Bedroom closet', `${ftin(C.cl2W)} × ${ftin(G.hallD)}`, G.rooms.closet],
  ],
  envelope: (C, G) => `${ftin(C.W)} × ${ftin(C.D)} less the ${ftin(C.livX)} × ${ftin(G.dy)} notch`,
  /* storage closet off the patio — enclosed, outside the envelope */
  bumpGross: (C, G) => (C.storW + C.wallInt + C.wallExt) * (C.patD + C.wallExt),
  pad: C => Math.max(2, C.patD + 2*C.wallExt + 1),
  seal: (C, G, stamp, PAD) => {
    const e = C.wallExt, bo = C.patD + 2*e;
    stamp([-PAD, -PAD, C.W + PAD, -bo]);                    // north of the bump-out
    stamp([-PAD, C.D + e, C.W + PAD, C.D + PAD]);           // south
    stamp([-PAD, -PAD, -e, C.D + PAD]);                     // west
    stamp([C.W + e, -PAD, C.W + PAD, C.D + PAD]);           // east
    stamp(mRect([-PAD, -bo, G.patX - e, -e]));              // beside the bump, west
    stamp(mRect([G.bumpE + e, -bo, C.W + PAD, -e]));        // beside the bump, east
    /* the L-notch: outdoors, even though it is inside the bounding box */
    stamp(mRect([-PAD, -e, C.livX - e, G.dy - e]));
  },
  routes: (C, G) => [
    ['Living', G.rooms.living], ['Dining', G.rooms.dining],
    ['Kitchen', G.rooms.kitchen], ['Bathroom', G.rooms.bath],
    ['Bedroom', G.rooms.bedroom], ['Patio', G.patio],
  ],
  /* the entry is in the WEST wall, so the threshold is a Y-range */
  entryProbe: (C, G) => [C.livX + 0.1, G.op.entry[0], C.livX + 2.2, G.op.entry[1]],
  /* this plan's outdoor floor is the patio, not a balcony — see the note on
     goldridge's `outdoor`. Furniture in the Balcony catalog group seeds here. */
  outdoor: (C, G) => G.patio,
  seedRect: (C, G, grp) =>
    grp === 'Bedroom' ? G.rooms.bedroom
    : grp === 'Dining' ? G.rooms.dining
    : grp === 'Balcony' ? G.patio
    : G.rooms.living,
  keepOut: (C, G) => {
    const m = C.clearMain || 3, e = G.op.entry;
    return [
      [C.livX, e[0] - 0.5, C.livX + m + 1, e[1] + 0.5],            // inside the front door
      [G.partX - m, C.bedD, G.partE + G.hallW, G.hy1],             // the hall and its mouth
      [G.op.bedDoor[0] - 0.5, C.bedD - m, G.op.bedDoor[1] + 0.5, C.bedD],
      [G.op.slider[0], 0, G.op.slider[1], m],                      // slider approach
      [G.kx, G.ky, G.kx + G.peny - G.ky, G.peny],                  // the way into the kitchen
    ];
  },
  derived: (C, G) => [
    ['Living width',       G.partX - C.livX, 'W − bedW − 4″ − livX'],
    ['Living + kitchen depth', G.ky,         'D − kitD'],
    ['Hall band depth',    G.hallD, 'D − bedD − bathD − 8″'],
    ['Hall width',         G.hallW, 'bedW − 8″ − cl1W − cl2W'],
    ['Linen closet depth', G.cl1D,  'hallD − whD − 4″'],
    ['Patio slider',       G.sliderW, 'partition − fireplace east face'],
    ['Dining width',       G.kx,    'W − bedW − 4″ − kitW'],
    ['Kitchen aisle',      (C.kitW - 2*C.counterD), 'kitW − 2 × 25″'],
    ['Bump-out width',     G.bumpE - G.patX, 'patW + 8″ + storW'],
  ],
  fit: (C, G, R, grade) => {
    const aisle = (C.kitW - 2*C.counterD) * 12;
    const brDoor = G.op.bedDoor[1] - G.op.bedDoor[0];
    return [
      { title: 'Built in — from the dimensions', rows: [
        /* a U-kitchen's working aisle is the gap between the two facing
           runs; here that is the east run against the partition and the
           peninsula */
        R('Kitchen aisle', Math.round(aisle) + '″',
          aisle < 36 ? 'fail' : aisle < 42 ? 'tight' : aisle > 60 ? 'tight' : 'pass',
          aisle < 42 ? 'Under the 42″ a U-kitchen wants between facing runs — the dishwasher and the oven cannot both be open.' : ''),
        R('Bedroom door in the hall', ftin(brDoor),
          G.hallW - brDoor >= 0.7 ? 'pass' : G.hallW - brDoor >= 0.3 ? 'tight' : 'fail',
          `Hall is ${ftin(G.hallW)} wide; the leaf swings into it.`),
        R('Patio slider', ftin(G.sliderW),
          G.sliderW >= 5 ? 'pass' : G.sliderW >= 4 ? 'tight' : 'fail',
          'Derived — it fills the gap between the fireplace and the bedroom partition, so it absorbs any change to either.'),
        R('Bedroom closet', `${ftin(C.cl2W)} × ${ftin(G.hallD)}`,
          C.cl2W >= 3 && G.hallD >= 4 ? 'pass' : 'tight',
          `Deep enough for the stacked washer/dryer the listing photos show, which would leave ${ftin(G.hallD - 2.6)} of hanging space in front of it. The drawing itself marks no laundry — only the water heater — so treat that as unconfirmed.`),
      ]},
      { title: 'Ground floor', rows: [
        R('Patio', `${ftin(C.patW)} × ${ftin(C.patD)}`,
          C.patD >= 6 ? 'pass' : C.patD >= 4 ? 'tight' : 'fail',
          `Deep enough for a small table and two chairs at ${ftin(C.patD)}; a 36″ round table plus pulled-out chairs wants about 7′-6″.`),
        R('Patio fence', ftin(C.guardH), 'pass',
          'Ground-floor unit — a solid privacy fence, not a 3′-6″ guard, and no entry stair.'),
      ]},
    ];
  },
  areaNote: (C, G, A) => `The listing states 616 sf. The drawing carries no dimension strings, so the scale came from the drawing itself — wall centrelines fit at ~35.4 px/ft, which independently makes the bedroom the 10′-1″ its own callout claims and the walls 7.6″ / 4.2″. At that scale the drawn envelope is ${A.gross.toFixed(0)} sf gross and ${A.net.toFixed(0)} sf net of partitions, so 616 sits between the two — this listing quotes INTERIOR, unlike Goldridge's 650, which is a gross-building figure. The two shortlist entries are not measured on the same basis; compare them on net floor, not on their headline numbers. The room callouts are usable-area figures, not wall-to-wall: the living room's “9′-3″ × 12′-7″” is the north part of a band this model draws ${ftin(G.partX - C.livX)} × ${ftin(G.ky)}.`,
  resetLabel: 'the leasing plan',
  constants: `Scaled off the drawing at 35.6 px/ft: exterior walls 7.6″, partitions 4.2″ —
     modelled at 8″ and 4″. Doors scale to 22–31″ on the sheet, which is narrower than any
     leaf that could be hung; they are set to standard 36″ entry / 32″ interior instead,
     because whether furniture fits through them is the point of the model.
     Counters 36″ high × 25″ deep, uppers at 54″.`,
  fields: [
    { t: 'Envelope & rooms — from the leasing plan',
      note: `The sheet is a marketing drawing with no dimension strings; every number here
             was scaled off it and should be replaced with a tape measurement. Change one
             and the whole plan re-solves.`,
      rows: [['W','Interior width'], ['D','Interior depth'], ['ceiling','Ceiling height'],
             ['livX','Dining bay width'], ['dinD','Dining bay depth'],
             ['bedW','Bedroom / bath width'], ['bedD','Bedroom depth'],
             ['bathD','Bathroom depth']] },
    { t: 'Kitchen & closets',
      note: `The kitchen is a U open to the dining room; kitOpen is the gap north of the
             peninsula you walk through. The hall width is whatever the two closets leave.`,
      rows: [['kitW','Kitchen width'], ['kitD','Kitchen depth'], ['kitOpen','Kitchen opening'],
             ['cl1W','Linen closet width'], ['cl2W','Bedroom closet width'],
             ['whD','Water-heater closet depth']] },
    { t: 'Fireplace & patio',
      note: `The fireplace sits in the living room's north wall with the built-in shelving
             beside it; the slider then fills whatever is left to the bedroom partition.`,
      rows: [['nicheW','Shelving width'], ['nicheD','Shelving depth'],
             ['fpW','Fireplace width'], ['fpD','Fireplace projection'],
             ['patW','Patio width'], ['patD','Patio depth'],
             ['storW','Storage width'], ['guardH','Fence height']] },
    { t: 'Glazing & front door',
      note: 'All three openings are in the west elevation, measured down from the north wall.',
      rows: [['winY','Living window from north'], ['winW','Living window width'],
             ['win2Y','Dining window from north'], ['winW2','Dining window width'],
             ['entryY','Front door from north']] },
  ],
});

/* ══════════════════════════════════════════════════════════════════
   3D EXPORT — .obj + .mtl and .gltf

   Same geometry the canvas draws, so it re-derives from CONFIG like
   everything else: change a dimension, export again, the mesh follows.

   Axis handling is the whole trick. The plan is authored X east, Y SOUTH,
   Z up to match how the sheet reads, which is left-handed geographically
   (the same reason toScreen mirrors). Exporters emit the standard
   right-handed Y-up frame instead:

       X_out = X (east)   Y_out = Z (up)   Z_out = Y (south)

   Swapping two axes is orientation-reversing, so every face is emitted
   with REVERSED winding to keep normals pointing out of the solid — skip
   that and the whole model imports inside-out.
   ══════════════════════════════════════════════════════════════════ */
const FT_M = 0.3048;                       // export in metres; glTF requires it
const MATNAME = m => Object.keys(M).find(k => M[k] === m) || 'mat';

/* a full-height, unculled build with fixtures on, then the live state back */
function exportGeometry() {
  const kf = showFixtures, kw = wallMode;
  showFixtures = true; wallMode = 'full'; EXPORTING = true;
  buildShell(); restack();
  for (const it of items) buildItem(it);
  const all = [...floorQuads, ...quads];   // snapshot before restoring
  showFixtures = kf; wallMode = kw; EXPORTING = false;
  buildShell();
  for (const it of items) buildItem(it);
  return all;
}
function groupQuads(qs) {
  const g = new Map();
  for (const q of qs) {
    const key = `${q.g}__${MATNAME(q.m)}`;
    let e = g.get(key); if (!e) g.set(key, e = { m: q.m, quads: [] });
    e.quads.push(q);
  }
  return g;
}

function buildOBJ() {
  const groups = groupQuads(exportGeometry()), V = [], faces = [];
  for (const [key, e] of groups) {
    const list = [];
    for (const q of e.quads) {
      const idx = [];
      for (const p of q.v) { V.push(p); idx.push(V.length); }
      list.push(idx.reverse());
    }
    faces.push([key, list]);
  }
  const n = v => v.toFixed(5).replace(/\.?0+$/, '') || '0';
  const out = [
    `# ${Math.round(C.W*C.D)} sq ft gross · one-bedroom unit, sheet A-101`,
    `# interior ${ftin(C.W)} × ${ftin(C.D)}, ceiling ${ftin(C.ceiling)}`,
    '# axes: X east, Y up, Z south · units: metres',
    'mtllib apartment.mtl', ''];
  for (const p of V) out.push(`v ${n(p[0]*FT_M)} ${n(p[2]*FT_M)} ${n(p[1]*FT_M)}`);
  out.push('');
  for (const [key, list] of faces) {
    out.push(`o ${key}`, `usemtl ${key.split('__')[1]}`);
    for (const f of list) out.push('f ' + f.join(' '));
    out.push('');
  }
  return out.join('\n');
}
function buildMTL() {
  const out = ['# materials for apartment.obj'];
  for (const [k, m] of Object.entries(M)) {
    const [r,g,b] = m.c.map(v => (v/255).toFixed(4));
    out.push(`newmtl ${k}`, 'Ka 0.0000 0.0000 0.0000', `Kd ${r} ${g} ${b}`,
             'Ks 0.0300 0.0300 0.0300', 'Ns 12.0', 'illum 2', 'd 1.0', '');
  }
  return out.join('\n');
}

const b64 = bytes => {
  let s = ''; const CH = 0x8000;
  for (let i=0;i<bytes.length;i+=CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i+CH));
  return typeof btoa === 'function' ? btoa(s) : Buffer.from(s, 'binary').toString('base64');
};

function buildGLTF() {
  const groups = groupQuads(exportGeometry());
  const bufferViews = [], accessors = [], meshes = [], nodes = [], materials = [];
  const matIx = new Map(), chunks = [];
  let off = 0;

  const put = (arr, target) => {
    const b = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
    const pad = (4 - (off % 4)) % 4;
    if (pad) { chunks.push(new Uint8Array(pad)); off += pad; }
    bufferViews.push({ buffer:0, byteOffset:off, byteLength:b.byteLength, ...(target?{target}:{}) });
    chunks.push(b); off += b.byteLength;
    return bufferViews.length - 1;
  };
  const acc = (view, type, comp, count, min, max) => {
    accessors.push({ bufferView:view, componentType:comp, count, type, ...(min?{min,max}:{}) });
    return accessors.length - 1;
  };

  for (const [key, e] of groups) {
    const name = MATNAME(e.m);
    if (!matIx.has(name)) {
      const [r,g,b] = e.m.c.map(v => Math.pow(v/255, 2.2));   // sRGB → linear
      matIx.set(name, materials.length);
      materials.push({ name, doubleSided:false,
        pbrMetallicRoughness:{ baseColorFactor:[+r.toFixed(4), +g.toFixed(4), +b.toFixed(4), 1],
                               metallicFactor:0, roughnessFactor:0.75 } });
    }
    const nq = e.quads.length;
    const pos = new Float32Array(nq*4*3), nrm = new Float32Array(nq*4*3);
    const idx = new Uint32Array(nq*6);
    const lo = [ Infinity, Infinity, Infinity], hi = [-Infinity,-Infinity,-Infinity];
    e.quads.forEach((q, qi) => {
      /* reversed winding, and the normal swapped the same way as position */
      const vs = [q.v[3], q.v[2], q.v[1], q.v[0]];
      const nz = [q.n[0], q.n[2], q.n[1]];
      vs.forEach((p, k) => {
        const o = (qi*4 + k)*3;
        const xyz = [p[0]*FT_M, p[2]*FT_M, p[1]*FT_M];
        for (let a=0;a<3;a++){ pos[o+a] = xyz[a]; nrm[o+a] = nz[a];
          if (xyz[a] < lo[a]) lo[a] = xyz[a];
          if (xyz[a] > hi[a]) hi[a] = xyz[a]; }
      });
      const b = qi*4, t = qi*6;
      idx[t]=b; idx[t+1]=b+1; idx[t+2]=b+2; idx[t+3]=b; idx[t+4]=b+2; idx[t+5]=b+3;
    });
    const aP = acc(put(pos, 34962), 'VEC3', 5126, nq*4, lo, hi);
    const aN = acc(put(nrm, 34962), 'VEC3', 5126, nq*4);
    const aI = acc(put(idx, 34963), 'SCALAR', 5125, nq*6);
    meshes.push({ name:key, primitives:[{ attributes:{ POSITION:aP, NORMAL:aN },
                                          indices:aI, material:matIx.get(name), mode:4 }] });
    nodes.push({ name:key, mesh: meshes.length - 1 });
  }

  const total = chunks.reduce((s,c) => s + c.length, 0);
  const buf = new Uint8Array(total);
  let p = 0; for (const c of chunks) { buf.set(c, p); p += c.length; }

  return JSON.stringify({
    asset:{ version:'2.0',
      generator:`Parametric unit model — sheet A-101, interior ${ftin(C.W)} × ${ftin(C.D)}` },
    scene:0, scenes:[{ name:'Unit', nodes: nodes.map((_,i) => i) }],
    nodes, meshes, materials, accessors, bufferViews,
    buffers:[{ byteLength: total, uri: 'data:application/octet-stream;base64,' + b64(buf) }],
  }, null, 1);
}

/* ══ camera — perspective and orthographic ═════════════════════════ */
/* az ≈ 90° is the plan-reading orientation once screen X is mirrored:
   east to the right, north up, matching sheet A-101. The target leans
   toward the entry stair, which sits outside whichever wall the door is in. */
/* The iso swings to whichever side the door is on, so the entry stair reads
   in the foreground instead of being hidden behind the far wall. Both
   azimuths are mirrored about 90°, so east stays to the right either way. */
/* The iso looks from the north-east so the balcony and the entry stair —
   which are on those two faces — are both in the foreground. Top view keeps
   az 90° so the plan reads like the sheet: east right, north up. */
/* framing follows the envelope, so a plan of a different size still lands
   in shot — the numbers used to be tuned to one unit's 28′ × 23′-6″ */
const VIEWS = () => {
  const s = Math.max(C.W || 28, C.D || 23.5), cx = (C.W || 28)/2 + 1;
  return {
    iso: { az: C.mirror ? 150 : 32, el:34, dist: s*2.15, tx: cx, ty: (C.D || 23.5)/2 - 2.75, tz:-1.0 },
    top: { az: 90, el:90, dist: s*2.07, tx: cx, ty: (C.D || 23.5)/2 - 4.25, tz:0 },
  };
};
const cam = { az:32, el:34, dist:60, tx:15, ty:9, tz:-1.0, fov:36 };
let ORTHO = false;
const NEAR = 0.06;

/* Plan is a claim about where you are standing: straight overhead. The moment
   the camera leaves that — an orbit that tips it, or jumping to the iso — the
   claim is false, so the projection drops to 3D and the toolbar switch is told
   to move with it. Spinning in place at el 90 is still a plan, just rotated,
   so that alone does not trip it. Only user-driven moves check: the glide INTO
   plan passes through tipped angles on its way up, and would otherwise cancel
   itself halfway. */
const OVERHEAD = 89.5;
function leaveOrtho() {
  if (!ORTHO) return;
  ORTHO = false;
  if (opts.onProjection) opts.onProjection(false);
}

function eye() {
  const ce = Math.cos(RAD(cam.el)), se = Math.sin(RAD(cam.el));
  /* In ortho the eye is pushed far back so every vertex lands in front
     of the near plane; x/y ignore depth anyway, so this is free. */
  const d = cam.dist + (ORTHO ? 400 : 0);
  return [cam.tx + d*ce*Math.cos(RAD(cam.az)),
          cam.ty + d*ce*Math.sin(RAD(cam.az)),
          cam.tz + d*se];
}
function basis() {
  const e = eye();
  const f = norm(sub([cam.tx,cam.ty,cam.tz], e));
  const r = norm(cross(f,[0,0,1]));
  return { e, f, r, u: cross(r,f) };
}

const cv = canvas;
const ctx = cv.getContext('2d');
let VW=0, VH=0, SC=1, B = basis();

function resize() {
  const dpr = Math.min(devicePixelRatio || 1, 2), r = cv.getBoundingClientRect();
  VW = Math.max(1, Math.round(r.width)); VH = Math.max(1, Math.round(r.height));
  cv.width = VW*dpr; cv.height = VH*dpr;
  ctx.setTransform(dpr,0,0,dpr,0,0);
  if (GL) { glcv.width = VW*dpr; glcv.height = VH*dpr; GL.viewport(0,0,glcv.width,glcv.height); }
  draw();
}

const toCam = p => { const v = sub(p, B.e); return [dot(v,B.r), dot(v,B.u), dot(v,B.f)]; };
/* Screen X is negated on purpose. The plan is authored the way the sheet reads
   — X east, Y SOUTH, Z up — which is a left-handed frame geographically, so
   projecting it with right-handed basis math lands the plan mirrored: north
   would render down while east rendered right, an orientation you can only see
   from under the floor. One reflection here puts it back, and every consumer of
   toScreen (labels, dimension strings, selection, grid) inherits the fix.
   `ray()` carries the same negation so picking still lines up with the pixels. */
function toScreen(c) {
  if (ORTHO) { const k = SC / cam.dist; return [VW/2 - k*c[0], VH/2 - k*c[1]]; }
  return [VW/2 - SC*c[0]/c[2], VH/2 - SC*c[1]/c[2]];
}
function clipNear(poly) {
  const out = [];
  for (let i=0;i<poly.length;i++){
    const a = poly[i], b = poly[(i+1)%poly.length];
    const ai = a[2] >= NEAR, bi = b[2] >= NEAR;
    if (ai) out.push(a);
    if (ai !== bi) {
      const t = (NEAR - a[2]) / (b[2] - a[2]);
      out.push([a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t, NEAR]);
    }
  }
  return out;
}
const LIGHT = norm([0.36,-0.62,0.79]);
const lambert = n => 0.52 + 0.48 * Math.max(0, dot(n, LIGHT));
function shade(n, m) {
  const k = lambert(n), c = m.c;
  return `rgb(${Math.round(c[0]*k)},${Math.round(c[1]*k)},${Math.round(c[2]*k)})`;
}

/* ══════════════════════════════════════════════════════════════════
   DEPTH BUFFER

   Faces used to be sorted back-to-front by depth and painted in that
   order. No single order is correct for a scene like this — a long wall
   and a chair standing in front of it have no consistent "one is behind
   the other", so whichever heuristic picks the order (centroid, nearest
   vertex, farthest) is wrong somewhere, and the wrongness moves as you
   orbit. That is the flickering, impossible perspective.

   So the solids now go through a GL layer with a real per-pixel depth
   buffer, sitting behind the 2D canvas. Nothing else changes: the same
   quads, the same flat lambert shading, the same projection maths, the
   same near clip. Overlays — labels, dimension strings, selection, the
   grid — stay on the 2D canvas on top, where they are meant to float.

   Vertices are handed to the GPU already in CAMERA space, so toCam and
   clipNear stay the single source of truth for how this model is seen
   and picking cannot drift out of step with the pixels.
   ══════════════════════════════════════════════════════════════════ */
let GL = null, glcv = null, glProg = null, glBufP = null, glBufC = null, glU = null;
let triP = [], triC = [], linP = [], linC = [];

const VSRC = `
attribute vec3 aPos; attribute vec3 aCol;
uniform float uSC, uVW, uVH, uDist, uPersp;
varying vec3 vCol;
void main() {
  vCol = aCol;
  float n = 0.06, f = 400.0;
  if (uPersp > 0.5) {
    float z = max(aPos.z, n);
    float ndcZ = ((f + n) * z - 2.0 * f * n) / ((f - n) * z);
    gl_Position = vec4(-2.0 * uSC * aPos.x / uVW, 2.0 * uSC * aPos.y / uVH, ndcZ * z, z);
  } else {
    float k = uSC / uDist;
    float ndcZ = (aPos.z - n) / (f + 600.0 - n) * 2.0 - 1.0;
    gl_Position = vec4(-2.0 * k * aPos.x / uVW, 2.0 * k * aPos.y / uVH, ndcZ, 1.0);
  }
}`;
const FSRC = `
precision mediump float;
uniform float uAlpha;
varying vec3 vCol;
void main() { gl_FragColor = vec4(vCol, uAlpha); }`;

function initGL() {
  const par = cv.parentNode;
  if (!par || typeof document === 'undefined') return;
  glcv = document.createElement('canvas');
  glcv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
  const GLOPT = { antialias: true, alpha: true, depth: true, preserveDrawingBuffer: true };
  const gl = glcv.getContext('webgl', GLOPT) || glcv.getContext('experimental-webgl', GLOPT);
  if (!gl) return;                                  // no GL: the 2D sort still runs
  cv.style.position = 'relative'; cv.style.zIndex = '1';
  par.insertBefore(glcv, cv);

  const sh = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, sh(gl.VERTEX_SHADER, VSRC));
  gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FSRC));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  gl.useProgram(p);

  glProg = p; glBufP = gl.createBuffer(); glBufC = gl.createBuffer();
  glU = {
    SC: gl.getUniformLocation(p, 'uSC'), VW: gl.getUniformLocation(p, 'uVW'),
    VH: gl.getUniformLocation(p, 'uVH'), dist: gl.getUniformLocation(p, 'uDist'),
    persp: gl.getUniformLocation(p, 'uPersp'), alpha: gl.getUniformLocation(p, 'uAlpha'),
    aPos: gl.getAttribLocation(p, 'aPos'), aCol: gl.getAttribLocation(p, 'aCol'),
  };
  gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
  gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  GL = gl;
}

function glBegin() {
  triP.length = 0; triC.length = 0; linP.length = 0; linC.length = 0;
  const gl = GL, dpr = Math.min(devicePixelRatio || 1, 2);
  if (glcv.width !== VW*dpr) { glcv.width = VW*dpr; glcv.height = VH*dpr; }
  gl.viewport(0, 0, glcv.width, glcv.height);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
}
/* one clipped, camera-space polygon → a triangle fan, plus its outline */
function glPush(cp, m, n) {
  const k = lambert(n), c = m.c;
  const r = c[0]/255*k, g = c[1]/255*k, b = c[2]/255*k;
  for (let i = 1; i < cp.length - 1; i++) {
    for (const v of [cp[0], cp[i], cp[i+1]]) { triP.push(v[0], v[1], v[2]); triC.push(r, g, b); }
  }
  if (!m.edge) return;
  for (let i = 0; i < cp.length; i++) {
    const a = cp[i], b2 = cp[(i+1) % cp.length];
    linP.push(a[0], a[1], a[2], b2[0], b2[1], b2[2]);
    linC.push(0.08, 0.09, 0.11, 0.08, 0.09, 0.11);
  }
}
function glEnd() {
  const gl = GL, u = glU;
  gl.useProgram(glProg);
  gl.uniform1f(u.SC, SC); gl.uniform1f(u.VW, VW); gl.uniform1f(u.VH, VH);
  gl.uniform1f(u.dist, cam.dist); gl.uniform1f(u.persp, ORTHO ? 0 : 1);
  const feed = (pos, col) => {
    gl.bindBuffer(gl.ARRAY_BUFFER, glBufP);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pos), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(u.aPos); gl.vertexAttribPointer(u.aPos, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, glBufC);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(col), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(u.aCol); gl.vertexAttribPointer(u.aCol, 3, gl.FLOAT, false, 0, 0);
  };
  if (triP.length) {
    gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1.0, 1.0);
    gl.uniform1f(u.alpha, 1);
    feed(triP, triC);
    gl.drawArrays(gl.TRIANGLES, 0, triP.length / 3);
    gl.disable(gl.POLYGON_OFFSET_FILL);
  }
  if (linP.length) {
    gl.uniform1f(u.alpha, 0.16);
    feed(linP, linC);
    gl.drawArrays(gl.LINES, 0, linP.length / 3);
  }
}

function paint(list, sort) {
  if (GL) {                                  // depth-buffered: order is irrelevant
    for (const q of list) {
      if (dot(q.n, sub(q.v[0], B.e)) >= 0) continue;    // backface
      const cp = clipNear(q.v.map(toCam));
      if (cp.length >= 3) glPush(cp, q.m, q.n);
    }
    return;
  }
  const prims = [];
  for (const q of list) {
    if (dot(q.n, sub(q.v[0], B.e)) >= 0) continue;      // backface
    const cp = clipNear(q.v.map(toCam));
    if (cp.length < 3) continue;
    let z = 0, zmin = Infinity;
    for (const c of cp) { z += c[2]; if (c[2] < zmin) zmin = c[2]; }
    prims.push({ pts: cp.map(toScreen), z: z/cp.length, zmin, m: q.m, n: q.n });
  }
  if (sort) prims.sort((a,b) => (b.zmin - a.zmin) || (b.z - a.z));
  for (const p of prims) {
    ctx.beginPath(); ctx.moveTo(p.pts[0][0], p.pts[0][1]);
    for (let i=1;i<p.pts.length;i++) ctx.lineTo(p.pts[i][0], p.pts[i][1]);
    ctx.closePath();
    ctx.fillStyle = shade(p.n, p.m); ctx.fill();
    if (p.m.edge) { ctx.strokeStyle = 'rgba(20,24,29,.16)'; ctx.lineWidth = .6; ctx.stroke(); }
  }
}

/* ══ overlays ══════════════════════════════════════════════════════ */
const THEME = Object.assign({
  '--ink':'#14181D', '--ink-2':'#57616F', '--ink-3':'#8A94A2', '--panel':'#F6F7F9',
  '--accent':'#2D6A9F', '--sel':'#C4703A', '--warn':'#B3402E', '--ok':'#3D7A4E',
  '--mono':'Menlo, monospace', '--display':'Futura, sans-serif',
}, opts.theme || {});
const cssv = v => THEME[v] || '#000';
const MONO = () => '10px ' + cssv('--mono').split(',')[0] + ', monospace';
const DISP = () => '500 10px ' + cssv('--display').split(',')[0] + ', sans-serif';

function seg3(a, b, style, w, dash) {
  const c = clipNear([toCam(a), toCam(b), toCam(b)]);
  if (c.length < 2) return;
  const p = toScreen(c[0]), q = toScreen(c[1]);
  ctx.save(); ctx.strokeStyle = style; ctx.lineWidth = w || 1;
  if (dash) ctx.setLineDash(dash);
  ctx.beginPath(); ctx.moveTo(p[0],p[1]); ctx.lineTo(q[0],q[1]); ctx.stroke(); ctx.restore();
}
function text3(p, lines) {
  const c = toCam(p); if (c[2] < NEAR) return;
  const s = toScreen(c);
  ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  let y = s[1] - (lines.length-1)*7;
  for (const l of lines) {
    ctx.font = l.font; ctx.lineWidth = 3.5; ctx.lineJoin = 'round';
    ctx.strokeStyle = cssv('--panel'); ctx.strokeText(l.t, s[0], y);
    ctx.fillStyle = l.color; ctx.fillText(l.t, s[0], y);
    y += 14;
  }
  ctx.restore();
}
function drawGrid() {
  const g = 'rgba(20,24,29,.10)';
  for (let x=0; x<=C.W; x++) seg3([x,0,.01],[x,C.D,.01], g, x%5===0?1:.5);
  for (let y=0; y<=C.D; y++) seg3([0,y,.01],[C.W,y,.01], g, y%5===0?1:.5);
}

/* rooms are derived, so labels and their dimension strings are too */
function roomList() {
  return U.rooms(C, G).map(([n, r, big]) => [n, mRect(r), big]);   // labels sit in the built unit
}
/* the five rooms A-101 schedules — used for the area table */
const scheduled = () => U.scheduled;
function drawLabels() {
  const ink = cssv('--ink'), dim = cssv('--ink-3');
  for (const [n, r, big] of roomList()) {
    const w = r[2]-r[0], d = r[3]-r[1];
    const lines = [{ t:n.toUpperCase(), font:DISP(), color:ink }];
    if (big) lines.push({ t:`${ftin(w)} × ${ftin(d)} · ${Math.round(w*d)} sf`, font:MONO(), color:dim });
    ctx.save(); ctx.letterSpacing = '1.4px';
    text3([(r[0]+r[2])/2, (r[1]+r[3])/2, .02], lines);
    ctx.restore();
  }
}
/* per-wall dimensions: overall always, per-room in plan view */
function drawDims() {
  const a = cssv('--accent'), off = 3.2;
  /* overall strings run south and east — the bump-out occupies the north side */
  const tick = (p,dx,dy) => seg3([p[0]-dx,p[1]-dy,0],[p[0]+dx,p[1]+dy,0], a, 1);
  const sy = C.D + off, ex = C.W + off;
  seg3([0,sy,0],[C.W,sy,0], a, 1); tick([0,sy],0,.35); tick([C.W,sy],0,.35);
  seg3([ex,0,0],[ex,C.D,0], a, 1); tick([ex,0],.35,0); tick([ex,C.D],.35,0);
  text3([C.W/2, sy+.9, 0], [{ t:ftin(C.W), font:MONO(), color:a }]);
  text3([ex+1.6, C.D/2, 0], [{ t:ftin(C.D), font:MONO(), color:a }]);

  if (!ORTHO) return;
  const d2 = cssv('--ink-3');
  for (const [n, r] of roomList()) {
    if (n === 'Balcony') continue;
    seg3([r[0]+.15, r[1]+.5, .02],[r[2]-.15, r[1]+.5, .02], d2, .6, [3,3]);
    seg3([r[0]+.5, r[1]+.15, .02],[r[0]+.5, r[3]-.15, .02], d2, .6, [3,3]);
    text3([(r[0]+r[2])/2, r[1]+1.0, .03], [{ t:ftin(r[2]-r[0]), font:MONO(), color:d2 }]);
    text3([r[0]+1.5, (r[1]+r[3])/2, .03], [{ t:ftin(r[3]-r[1]), font:MONO(), color:d2 }]);
  }
}

/* ══ catalog — real sizes in inches, with the clearance each piece needs ══
   clr is [−Y, +X, +Y, −X] in inches, in the piece's own frame before
   rotation. In that frame a sofa's back and a bed's headboard face −Y,
   so −Y is the "against the wall" side and +Y is the front. 0 means the
   piece may sit flush.                                                  */
const CAT = [
 { g:'Living', items:[
   {k:'sofa84', n:'Sofa',           w:84,d:36,h:32,s:'sofa',  clr:[0,0,18,0], rule:'sofaCoffee'},
   {k:'sofa72', n:'Apartment sofa', w:72,d:34,h:32,s:'sofa',  clr:[0,0,18,0], rule:'sofaCoffee'},
   {k:'love',   n:'Loveseat',       w:60,d:34,h:32,s:'sofa',  clr:[0,0,18,0]},
   {k:'sect',   n:'Sectional, L',   w:96,d:64,h:32,s:'sect',  clr:[0,0,18,0]},
   {k:'arm',    n:'Armchair',       w:33,d:34,h:32,s:'sofa',  clr:[0,0,18,0]},
   {k:'ott',    n:'Ottoman',        w:30,d:20,h:17,s:'soft'},
   {k:'coffee', n:'Coffee table',   w:48,d:24,h:18,s:'table', clr:[16,16,16,16]},
   {k:'side',   n:'Side table',     w:22,d:22,h:24,s:'round'},
   {k:'media',  n:'Media console',  w:58,d:16,h:24,s:'case'},
   {k:'tv55',   n:'TV, 55″',        w:48,d: 3,h:28,s:'tv'},
   {k:'tv65',   n:'TV, 65″',        w:57,d: 3,h:33,s:'tv'},
   {k:'shelf',  n:'Bookcase',       w:32,d:12,h:72,s:'case'},
   /* ── IKEA, measured off the product pages, 2026-08-01. Fractions are the
         listed sizes converted straight to decimal inches — 46 5/8″ is 46.625,
         not "about 47". ── */
   {k:'billy',  n:'BILLY bookcase',  w:31.5,  d:11,     h:41.75,  s:'case'},
   {k:'eket4',  n:'EKET cabinet, 4 comp', w:27.5, d:13.75, h:27.5, s:'case'},
   {k:'radcab', n:'RÅDMANSÖ cabinet', w:46.625, d:19.125, h:40.625, s:'case', clr:[0,0,30,0]},
   {k:'lamp',   n:'Floor lamp',     w:16,d:16,h:60,s:'lamp'},
   {k:'rug57',  n:'Rug, 5 × 7',     w:60,d:84, h:1,s:'rug'},
   {k:'rug810', n:'Rug, 8 × 10',    w:96,d:120,h:1,s:'rug'},
   {k:'rug912', n:'Rug, 9 × 12',    w:108,d:144,h:1,s:'rug'},
 ]},
 { g:'Dining', items:[
   {k:'dround', n:'Round table 48″',w:48,d:48,h:30,s:'round',clr:[36,36,36,36], rule:'diningChair'},
   {k:'drect',  n:'Table, 60 × 36', w:60,d:36,h:30,s:'table', clr:[36,36,36,36], rule:'diningChair'},
   {k:'dsq',    n:'Table, 36 × 36', w:36,d:36,h:30,s:'table', clr:[36,36,36,36], rule:'diningChair'},
   {k:'cafe',   n:'Café table, 35″', w:34.625,d:30.75,h:29,s:'cafe', clr:[30,30,30,30], rule:'diningChair'},
   {k:'dchair', n:'Dining chair',   w:18,d:20,h:34,s:'chair'},
   {k:'stool',  n:'Counter stool',  w:16,d:16,h:26,s:'stool'},
   {k:'sideb',  n:'Sideboard',      w:60,d:18,h:32,s:'case'},
   /* ── IKEA ── the gateleg is listed as both entries on purpose: a drop-leaf
         is bought for the folded footprint and lived in at the open one, and
         the clearance checker can only grade one shape at a time. ── */
   {k:'alhult',   n:'ÅLHULT table',            w:31.5,   d:29.125, h:29.5, s:'table', clr:[36,36,36,36], rule:'diningChair'},
   {k:'pinnfold', n:'PINNTORP gateleg, folded', w:26.375, d:29.5,  h:29.5, s:'table', clr:[36,36,36,36], rule:'diningChair'},
   {k:'pinnopen', n:'PINNTORP gateleg, open',   w:48.875, d:29.5,  h:29.5, s:'table', clr:[36,36,36,36], rule:'diningChair'},
 ]},
 { g:'Bedroom', items:[
   {k:'king',   n:'King bed',   w:76,d:80,h:24,s:'bed', clr:[0,24,30,24], rule:'bed'},
   {k:'queen',  n:'Queen bed',  w:60,d:80,h:24,s:'bed', clr:[0,24,30,24], rule:'bed'},
   {k:'full',   n:'Full bed',   w:54,d:75,h:24,s:'bed', clr:[0,24,30,24], rule:'bed'},
   {k:'twin',   n:'Twin bed',   w:38,d:75,h:24,s:'bed', clr:[0,24,30,0],  rule:'bed'},
   {k:'night',  n:'Nightstand', w:20,d:18,h:25,s:'case'},
   {k:'dress',  n:'Dresser',    w:60,d:18,h:32,s:'case', clr:[0,0,30,0]},
   {k:'tall',   n:'Tall dresser',w:34,d:18,h:50,s:'case',clr:[0,0,30,0]},
   {k:'ward',   n:'Wardrobe',   w:48,d:24,h:72,s:'case', clr:[0,0,30,0]},
   {k:'bench',  n:'Bed bench',  w:48,d:18,h:18,s:'soft'},
   /* ── IKEA ── w × d are the frame's own overall size, NOT the mattress:
         both of these are queens, and both are wider and longer than the
         generic 60 × 80 above, which is the point of listing them.
         h stays at the catalog's 24″ mattress-top convention — IKEA does not
         publish one, since it depends on the mattress you put in. ── */
   {k:'radbed',   n:'RÅDMANSÖ bed, queen', w:63,     d:87.375, h:24, s:'bed', clr:[0,24,30,24], rule:'bed'},
   {k:'idanas',   n:'IDANÄS bed, queen',   w:62.625, d:88.25,  h:24, s:'bed', clr:[0,24,30,24], rule:'bed'},
   {k:'radnight', n:'RÅDMANSÖ nightstand', w:21.25,  d:15.125, h:22.875, s:'case'},
   {k:'raddres6', n:'RÅDMANSÖ 6-drawer dresser', w:62.625, d:18.875, h:31.875, s:'case', clr:[0,0,30,0]},
   {k:'raddres5', n:'RÅDMANSÖ 5-drawer chest',   w:27.5,   d:18.875, h:52,     s:'case', clr:[0,0,30,0]},
 ]},
 { g:'Work & other', items:[
   {k:'desk63', n:'Desk, 63″ walnut', w:63,d:31.5,h:29,s:'desk', clr:[0,0,30,0]},
   {k:'desk48', n:'Desk, 48″',  w:48,d:24,h:30,s:'table', clr:[0,0,30,0]},
   {k:'desk60', n:'Desk, 60″',  w:60,d:30,h:30,s:'table', clr:[0,0,30,0]},
   {k:'ergo',   n:'Ergonomic task chair', w:27,d:27,h:40,s:'ergo'},
   {k:'task',   n:'Desk chair', w:26,d:26,h:38,s:'chair'},
   {k:'console',n:'Console table',w:48,d:14,h:30,s:'table'},
   {k:'plant',  n:'Plant',      w:22,d:22,h:52,s:'plant'},
   {k:'cube',   n:'Storage cubes',w:30,d:15,h:30,s:'case'},
   {k:'bike',   n:'Bike, upright',w:68,d:22,h:42,s:'soft'},
 ]},
 /* Outdoor. inBounds() already allowed the bump-out; what was missing was
    anything anyone would put there, and a seedRect case to drop it out there
    rather than in the living room. Both plans map this group to their own
    outdoor floor — goldridge's balcony, hazel's patio.
    The bistro table's clearance is front-and-back only: on a 5′-7½″-deep
    balcony you pull a chair out along the long axis, never across it. */
 { g:'Balcony', items:[
   {k:'tarnotab', n:'TÄRNÖ table',          w:21,    d:21.625, h:27.5, s:'table', clr:[24,0,24,0]},
   {k:'tarnochr', n:'TÄRNÖ folding chair',  w:15,    d:15.75,  h:31,   s:'chair'},
   {k:'morum',    n:'MORUM rug, in/outdoor',w:63,    d:91,     h:0.25, s:'rug'},
   /* one 9-tile pack laid 3 × 3. IKEA quotes 8.72 sq ft a pack; 35¼″ square
      is 8.63, the difference being the interlocking edges. */
   {k:'runnen',   n:'RUNNEN decking, 3 × 3',w:35.25, d:35.25,  h:0.75, s:'deck'},
 ]},
];
const BYKEY = {}; CAT.forEach(g => g.items.forEach(it => BYKEY[it.k] = it));

let items = [], selId = null, nextId = 1;
const spec = it => BYKEY[it.k];
const fW = it => spec(it).w/12, fD = it => spec(it).d/12, fH = it => spec(it).h/12;
/* Floor coverings. Flat, stacked under everything and never on top of it, not
   counted as furniture coverage, and never in another piece's way. Rugs and
   deck tiles are identical in all four respects, so every place that used to
   test `s === 'rug'` asks this instead — adding a third covering means adding
   it here and nowhere else. */
const isFloorCover = it => { const s = spec(it).s; return s === 'rug' || s === 'deck'; };

/* ══════════════════════════════════════════════════════════════════
   STACKING

   Two pieces sharing a footprint used to interpenetrate at floor level.
   They now sit ON each other: a lamp dragged onto a side table rests on
   it, a TV lands on the console, and dragging the support away drops
   whatever was on it back to the floor.

   Order is placement order — a piece can only rest on something placed
   before it — so the resolve is a single ordered pass with no cycles to
   break and no ambiguity about which of two pieces is on top. Rugs are
   the exception in one direction: things stack ON a rug, a rug never
   climbs onto the furniture.
   ══════════════════════════════════════════════════════════════════ */
function restack() {
  const list = items.slice().sort((a, b) => a.id - b.id);
  for (const it of list) {
    if (isFloorCover(it)) { it.z = 0; continue; }
    let z = 0;
    const c = corners(it);
    for (const o of list) {
      if (o.id >= it.id) break;
      /* pieces that belong together never stack — a chair tucks under its
         desk, a nightstand beside its bed; they do not climb on each other */
      if (partnered(it, o)) continue;
      if (overlapsRect(c, bboxOf(o))) z = Math.max(z, (o.z || 0) + fH(o));
    }
    it.z = z + fH(it) <= C.ceiling ? z : 0;      // never through the ceiling
  }
}

function xf(it, lx, ly) {
  const a = RAD(it.rot), c = Math.cos(a), s = Math.sin(a);
  return [it.x + lx*c - ly*s, it.y + lx*s + ly*c];
}
function rbox(it, lx0,ly0,z0, lx1,ly1,z1, m) {
  const b = it.z || 0; z0 += b; z1 += b;
  const c = [[lx0,ly0],[lx1,ly0],[lx1,ly1],[lx0,ly1]].map(p => xf(it,p[0],p[1]));
  const lo = c.map(p=>[p[0],p[1],z0]), hi = c.map(p=>[p[0],p[1],z1]);
  pushQ(hi, m); pushQ([lo[0],lo[3],lo[2],lo[1]], m);
  for (let i=0;i<4;i++){ const j=(i+1)%4; pushQ([lo[i],lo[j],hi[j],hi[i]], m); }
}
function rprism(it, lcx,lcy, z0,z1, r, n, m) {
  const b = it.z || 0; z0 += b; z1 += b;
  const pts = [];
  for (let i=0;i<n;i++){ const a = i/n*Math.PI*2; pts.push(xf(it, lcx+Math.cos(a)*r, lcy+Math.sin(a)*r)); }
  pushQ(pts.map(p=>[p[0],p[1],z1]), m);
  for (let i=0;i<n;i++){ const a=pts[i], b=pts[(i+1)%n];
    pushQ([[a[0],a[1],z0],[b[0],b[1],z0],[b[0],b[1],z1],[a[0],a[1],z1]], m); }
}

function buildItem(it) {
  const S = spec(it), w = fW(it), d = fD(it), h = fH(it);
  GRP = `furniture_${it.k}_${it.id}`;
  const X = w/2, Y = d/2, sel = it.id === selId;
  const up = sel?M.sel:M.uphol, wd = sel?M.sel:M.wood;
  const ck = sel?M.sel:M.dark, mt = sel?M.sel:M.metal;
  switch (S.s) {
    case 'sofa': case 'sect': {
      const arm=.42, back=.28, seat=h*.48, ch = S.s==='sect';
      const bd = ch ? d*.55 : d, Y1 = -Y+bd;
      rbox(it,-X,-Y,0,X,Y1,seat,up);
      rbox(it,-X,-Y,seat,X,-Y+back,h,up);
      rbox(it,-X,-Y,seat,-X+arm,Y1,h*.78,up);
      rbox(it,X-arm,-Y,seat,X,Y1,h*.78,up);
      rbox(it,-X+arm,-Y+back,seat,X-arm,Y1-.05,seat+.22,up);
      if (ch) { rbox(it,X-bd,Y1,0,X,Y,seat,up); rbox(it,X-arm,Y1,seat,X,Y,h*.78,up); }
      break; }
    case 'chair': {
      const seat = h*.46;
      rbox(it,-X,-Y,seat-.12,X,Y,seat,up); rbox(it,-X,-Y,seat,X,-Y+.14,h,up);
      for (const [sx,sy] of [[-1,-1],[1,-1],[-1,1],[1,1]])
        rbox(it,sx*X-sx*.16,sy*Y-sy*.16,0,sx*X,sy*Y,seat-.12,mt);
      break; }
    /* Leap: five-star base on casters, gas column, contoured back with a
       lumbar band, height-adjustable arms. Back is −Y, as with every piece. */
    case 'ergo': {
      const st = 1.5;                                   // seat at 18″
      const fab = sel ? M.sel : M.fabric, mt = sel ? M.sel : M.steel;
      for (let i = 0; i < 5; i++) {
        const a = i / 5 * Math.PI * 2 + Math.PI / 2;
        rprism(it, Math.cos(a)*.85, Math.sin(a)*.85, 0, .18, .09, 8, mt);   // casters
      }
      rprism(it, 0, 0, .2, .3, .8, 10, mt);              // star base
      rprism(it, 0, 0, .3, st - .12, .13, 10, mt);       // gas column
      rbox(it, -.8, -.72, st - .12, .8, .78, st + .06, fab);            // seat pan
      rbox(it, -.79, -.78, st + .06, .79, -.62, h, fab);                // back
      rbox(it, -.7, -.62, st + .35, .7, -.5, st + 1.0, fab);            // lumbar
      for (const s of [-1, 1]) {
        rbox(it, s*.86 - .06, -.5, st, s*.86 + .06, -.34, st + .62, mt);      // arm post
        rbox(it, s*.86 - .12, -.52, st + .62, s*.86 + .12, .18, st + .72, fab); // pad
      }
      break; }
    case 'stool':
      rprism(it,0,0,h-.15,h,X,12,up); rprism(it,0,0,0,h-.15,X*.22,8,mt);
      rprism(it,0,0,0,.08,X*.8,12,mt); break;
    case 'bed': {
      const mat = h*.55, pw = (w-.5)/2;
      rbox(it,-X+.1,-Y+.1,0,X-.1,Y-.1,mat*.7,wd);
      rbox(it,-X,-Y,mat*.7,X,Y,h,sel?M.sel:M.porc);
      rbox(it,-X,-Y-.22,0,X,-Y,3.4,wd);
      rbox(it,-X+.16,-Y+.25,h,-X+.16+pw,-Y+1.6,h+.35,sel?M.sel:M.porc);
      rbox(it,X-.16-pw,-Y+.25,h,X-.16,-Y+1.6,h+.35,sel?M.sel:M.porc);
      break; }
    case 'table': {
      const t=.14, lg=.16;
      rbox(it,-X,-Y,h-t,X,Y,h,wd);
      for (const [sx,sy] of [[-1,-1],[1,-1],[-1,1],[1,1]])
        rbox(it,sx*X-sx*lg-sx*.06,sy*Y-sy*lg-sy*.06,0,sx*X-sx*.06,sy*Y-sy*.06,h-t,wd);
      break; }
    /* MITTZON: a 1¼″ veneered top, T-legs with a foot bar and a top bracket,
       a middle rail between them and the cable tray slung under the back edge.
       Back is −Y, the side the clearance rule keeps free is +Y. */
    case 'desk': {
      const tt = 1.25/12, lg = .16, ft = .12;
      const top = sel ? M.sel : M.walnut, fr = sel ? M.sel : M.steel;
      rbox(it, -X, -Y, h - tt, X, Y, h, top);
      for (const s of [-1, 1]) {
        const cx = s * (X - .3);
        rbox(it, cx - lg/2, -.2, ft, cx + lg/2, .2, h - tt, fr);              // upright
        rbox(it, cx - .14, -Y + .22, 0, cx + .14, Y - .22, ft, fr);           // foot bar
        rbox(it, cx - .22, -Y + .34, h - tt - .12, cx + .22, Y - .34, h - tt, fr);
      }
      rbox(it, -(X - .34), -Y*.34, h - .95, X - .34, -Y*.34 + .1, h - .82, fr);  // middle rail
      rbox(it, -1.5, -Y + .2, h - tt - .5, 1.5, -Y + .62, h - tt - .24, fr);     // cable tray
      break; }
    /* tapered legs, splayed a little: three stacked segments per leg, each
       narrower and stepped outward, which reads as the taper at this scale */
    case 'cafe': {
      const tt = 1.1/12;
      const top = sel ? M.sel : M.blackash, lg = sel ? M.sel : M.dark;
      rbox(it, -X, -Y, h - tt, X, Y, h, top);
      for (const [sx, sy] of [[-1,-1],[1,-1],[-1,1],[1,1]]) {
        const px = sx * (X - .16), py = sy * (Y - .16);
        for (const [z1, z0, r, off] of [[h-tt, h-tt-.9, .075, 0],
                                        [h-tt-.9, h-tt-1.7, .062, .035],
                                        [h-tt-1.7, 0, .05, .07]])
          rprism(it, px + sx*off, py + sy*off, z0, z1, r, 4, lg);
      }
      break; }
    case 'round':
      rprism(it,0,0,h-.14,h,X,16,wd); rprism(it,0,0,.1,h-.14,X*.16,8,wd);
      rprism(it,0,0,0,.1,X*.55,16,wd); break;
    case 'case':
      rbox(it,-X,-Y,0,X,Y,h-.08,ck); rbox(it,-X-.04,-Y-.04,h-.08,X+.04,Y+.04,h,wd); break;
    case 'soft': rbox(it,-X,-Y,0,X,Y,h,up); break;
    case 'rug':  rbox(it,-X,-Y,.05,X,Y,.05+h,sel?M.sel:M.rugm); break;
    /* interlocking deck tiles — same flat slab as a rug, but in the deck
       colour, and it belongs on the balcony rather than over the oak */
    case 'deck': rbox(it,-X,-Y,.05,X,Y,.05+h,sel?M.sel:M.deck); break;
    case 'tv':
      rbox(it,-X,-Y,h*.18,X,Y,h,sel?M.sel:M.screen);
      rbox(it,-X*.25,-Y-.35,0,X*.25,Y+.35,h*.18,mt); break;
    case 'lamp':
      rprism(it,0,0,0,.06,X*.75,12,mt); rprism(it,0,0,.06,h-.9,.05,6,mt);
      rprism(it,0,0,h-.9,h,X*.9,12,sel?M.sel:M.porc); break;
    case 'plant':
      rprism(it,0,0,0,h*.28,X*.72,10,sel?M.sel:M.cab);
      rprism(it,0,0,h*.28,h,X*.95,8,sel?M.sel:M.leaf); break;
    default: rbox(it,-X,-Y,0,X,Y,h,up);
  }
}

/* ══════════════════════════════════════════════════════════════════
   CLEARANCE ENGINE

   Two independent questions:
     A. Does each piece physically collide with a wall or fixture?
     B. Can you still walk through, and how narrow does it get?

   (B) builds an occupancy grid, runs a chamfer distance transform,
   then finds the WIDEST route to each room. It reports the narrowest
   pinch in inches rather than pass/fail, because a 32″ door is a real
   pinch but not a failure — a checker that flagged it would be noise.
   ══════════════════════════════════════════════════════════════════ */
const CELL = 0.25;
const RULES = {
  bed:         { min:24, good:30, label:'clearance beside the bed' },
  diningChair: { min:36, good:36, label:'to pull a dining chair out' },
  sofaCoffee:  { min:16, max:18,  label:'sofa to coffee table' },
  galley:      { min:42, good:48, label:'galley aisle' },
  main:        { min:36, good:36, label:'main circulation' },
};

const corners = it => {
  const w = fW(it)/2, d = fD(it)/2;
  return [[-w,-d],[w,-d],[w,d],[-w,d]].map(p => xf(it,p[0],p[1]));
};
/* the piece's footprint grown by its declared clearance, in its own frame */
function clearPoly(it) {
  const S = spec(it); if (!S.clr) return null;
  const w = fW(it)/2, d = fD(it)/2, [f,r,b,l] = S.clr.map(v => v/12);
  return [[-w-l,-d-f],[w+r,-d-f],[w+r,d+b],[-w-l,d+b]].map(p => xf(it,p[0],p[1]));
}
function overlapsRect(poly, rect) {
  const [x0,y0,x1,y1] = rect, rc = [[x0,y0],[x1,y0],[x1,y1],[x0,y1]];
  const axes = [[1,0],[0,1]];
  for (let i=0;i<poly.length;i++){
    const a = poly[i], b = poly[(i+1)%poly.length];
    axes.push(norm([-(b[1]-a[1]), b[0]-a[0], 0]));
  }
  for (const ax of axes) {
    let p0=Infinity,p1=-Infinity,q0=Infinity,q1=-Infinity;
    for (const p of poly){ const v=p[0]*ax[0]+p[1]*ax[1]; p0=Math.min(p0,v); p1=Math.max(p1,v); }
    for (const p of rc) { const v=p[0]*ax[0]+p[1]*ax[1]; q0=Math.min(q0,v); q1=Math.max(q1,v); }
    if (p1 <= q0+1e-7 || q1 <= p0+1e-7) return false;
  }
  return true;
}
/* ══ the wall constraint ═══════════════════════════════════════════
   Walls and built-in casework are the one part of this model that never
   moves, so nothing may be dragged through them. `blockers` already holds
   every wall segment (with its door and window gaps) plus the counters,
   tub, W/D and fridge — this is the single test everything that moves a
   piece has to pass.

   Bounds are checked on the FOOTPRINT, not the centre. Centre-only lets a
   sofa sit half-through the entry door, which is exactly the thing being
   asked to stop. A piece must sit wholly inside the unit, or wholly on the
   balcony deck — the slider threshold is not a parking space.
   ══════════════════════════════════════════════════════════════════ */
function inBounds(it) {
  const [x0,y0,x1,y1] = bboxOf(it);          // defined below; called at runtime
  if (x0 >= 0 && x1 <= C.W && y0 >= 0 && y1 <= C.D) return true;
  /* Was mRect(G.balcony). Only goldridge derives a `balcony`; hazel derives a
     `patio`, so on that plan this destructured undefined and threw the moment
     a piece left the envelope. Nothing had reached it before, because until the
     Balcony catalog group there was no furniture anyone would put out there. */
  const [b0,b1,b2,b3] = mRect(U.outdoor(C, G));
  return x0 >= b0 && x1 <= b2 && y0 >= b1 && y1 <= b3;
}
function placeable(it) {
  const poly = corners(it);
  for (const r of blockers) if (overlapsRect(poly, r)) return false;
  return inBounds(it);
}
/* would the piece be legal at (x,y)? tested without committing the move */
function freeAt(it, x, y, rot) {
  const px = it.x, py = it.y, pr = it.rot;
  it.x = x; it.y = y; if (rot !== undefined) it.rot = rot;
  const ok = placeable(it);
  it.x = px; it.y = py; it.rot = pr;
  return ok;
}
/* Try the whole move, then each axis alone, so a piece SLIDES along a wall
   instead of sticking the instant one direction is blocked. If it is already
   overlapping — an older layout, or a dimension change moved a wall onto it —
   movement is left free, otherwise it would be trapped there for good. */
function slide(it, nx, ny) {
  if (!placeable(it))              return [nx, ny];
  if (freeAt(it, nx, ny))          return [nx, ny];
  if (freeAt(it, nx, it.y))        return [nx, it.y];
  if (freeAt(it, it.x, ny))        return [it.x, ny];
  return [it.x, it.y];
}
function fits(it) { return placeable(it); }
/* does the piece's required clearance envelope stay clear? */
/* Pieces that BELONG in each other's clearance zone. A coffee table sitting
   16″ off the sofa is the rule being satisfied, not violated; the same goes
   for chairs at a dining table and a nightstand beside a bed. Without this
   every correct arrangement reports as obstructed. */
const PARTNERS = {
  sofa84:['coffee','ott','rug57','rug810','rug912'], sofa72:['coffee','ott'],
  love:['coffee','ott'], sect:['coffee','ott'], arm:['coffee','ott','side'],
  coffee:['sofa84','sofa72','love','sect','arm','ott'],
  dround:['dchair'], drect:['dchair'], dsq:['dchair'], cafe:['dchair','stool'],
  desk63:['ergo','task'], desk48:['ergo','task'], desk60:['ergo','task'],
  ergo:['desk63','desk48','desk60'], task:['desk63','desk48','desk60'],
  king:['night','bench'], queen:['night','bench'],
  full:['night','bench'], twin:['night','bench'],
};
const partnered = (a,b) =>
  (PARTNERS[a.k] || []).includes(b.k) || (PARTNERS[b.k] || []).includes(a.k);

function clearanceOK(it) {
  const cp = clearPoly(it); if (!cp) return null;
  for (const r of blockers) if (overlapsRect(cp, r)) return false;
  for (const o of items) {
    if (o.id === it.id || isFloorCover(o) || partnered(it, o) || o.z > 0) continue;
    if (overlapsRect(cp, bboxOf(o))) return false;
  }
  return true;
}
const bboxOf = it => {
  const c = corners(it);
  return [Math.min(...c.map(p=>p[0])), Math.min(...c.map(p=>p[1])),
          Math.max(...c.map(p=>p[0])), Math.max(...c.map(p=>p[1]))];
};
/* sofa ↔ coffee table wants a RANGE: too close is as wrong as too far */
function sofaCoffeeGap() {
  const sofas = items.filter(i => spec(i).rule === 'sofaCoffee');
  const tables = items.filter(i => i.k === 'coffee');
  if (!sofas.length || !tables.length) return null;
  let best = Infinity;
  for (const s of sofas) for (const t of tables) {
    const d = Math.hypot(s.x-t.x, s.y-t.y) - fD(s)/2 - fD(t)/2;
    best = Math.min(best, d);
  }
  return best * 12;
}

/* ── circulation ──
   The grid is PADDED beyond the envelope. Without the pad the exterior
   walls fall outside it and never get stamped, so the grid edge behaves
   as one unbroken wall and the entry door ceases to exist — every route
   then reports the same number, which is how this bug announced itself. */
/* margin must be deep enough to hold the balcony deck */
const PADF = () => U.pad(C);
function occupancy() {
  const PAD = PADF();
  const nx = Math.ceil((C.W + 2*PAD)/CELL), ny = Math.ceil((C.D + 2*PAD)/CELL);
  const g = new Uint8Array(nx*ny);
  const stampRect = ([x0,y0,x1,y1]) => {
    const i0=Math.max(0,Math.floor((x0+PAD)/CELL)), i1=Math.min(nx,Math.ceil((x1+PAD)/CELL));
    const j0=Math.max(0,Math.floor((y0+PAD)/CELL)), j1=Math.min(ny,Math.ceil((y1+PAD)/CELL));
    for (let j=j0;j<j1;j++) for (let i=i0;i<i1;i++) g[j*nx+i]=1;
  };
  /* rounds OUTWARD, matching stampRect. Rounding inward here leaves a
     one-cell blocked seam at the wall's outer face that seals the slider. */
  const clearRect = ([x0,y0,x1,y1]) => {
    const i0=Math.max(0,Math.floor((x0+PAD)/CELL)), i1=Math.min(nx,Math.ceil((x1+PAD)/CELL));
    const j0=Math.max(0,Math.floor((y0+PAD)/CELL)), j1=Math.min(ny,Math.ceil((y1+PAD)/CELL));
    for (let j=j0;j<j1;j++) for (let i=i0;i<i1;i++) g[j*nx+i]=0;
  };
  /* Outside is not walkable — otherwise a route could leave by the front
     door and loop around the building to the balcony slider. Seal from the
     OUTER face of the exterior wall outward: the wall band itself is already
     in `blockers`, complete with its door and slider gaps, and stamping over
     it here would seal those openings shut.

     The bump-out side is sealed only beyond the bump-out, so the deck and
     any closets inside it stay walkable without a clearRect. Which strips
     get sealed depends on the footprint, so the plan supplies it. */
  U.seal(C, G, stampRect, PAD);

  for (const r of blockers) stampRect(r);
  for (const it of items) if (spec(it).s !== 'rug' && !(it.z > 0.9)) stampRect(bboxOf(it));
  return { g, nx, ny };
}
const cellOf = (x,y) => { const P = PADF();
  return [Math.floor((x+P)/CELL), Math.floor((y+P)/CELL)]; };
/* the point you'd actually stand in — the most open cell in the room,
   not its centroid, which may sit against a wall or under a fixture */
function openestCell(dist, nx, ny, [x0,y0,x1,y1]) {
  let best = -1, bi = -1, bj = -1;
  const [i0,j0] = cellOf(x0,y0), [i1,j1] = cellOf(x1,y1);
  for (let j=Math.max(0,j0); j<Math.min(ny,j1); j++)
    for (let i=Math.max(0,i0); i<Math.min(nx,i1); i++) {
      const v = dist[j*nx+i];
      if (v > best) { best = v; bi = i; bj = j; }
    }
  return bi < 0 ? null : { i: bi, j: bj, clear: best };
}
function distanceField({ g, nx, ny }) {
  const d = new Float32Array(nx*ny), INF = 1e9, A = 1, Bd = Math.SQRT2;
  for (let k=0;k<d.length;k++) d[k] = g[k] ? 0 : INF;
  const at = (i,j) => (i<0||j<0||i>=nx||j>=ny) ? 0 : d[j*nx+i];
  for (let j=0;j<ny;j++) for (let i=0;i<nx;i++){ const k=j*nx+i; if(!d[k])continue;
    d[k]=Math.min(d[k],at(i-1,j)+A,at(i,j-1)+A,at(i-1,j-1)+Bd,at(i+1,j-1)+Bd); }
  for (let j=ny-1;j>=0;j--) for (let i=nx-1;i>=0;i--){ const k=j*nx+i; if(!d[k])continue;
    d[k]=Math.min(d[k],at(i+1,j)+A,at(i,j+1)+A,at(i+1,j+1)+Bd,at(i-1,j+1)+Bd); }
  for (let k=0;k<d.length;k++) d[k]*=CELL;
  return d;
}
function widestRoutes() {
  const grid = occupancy(), dist = distanceField(grid), { nx, ny } = grid;
  const targets = U.routes(C, G)
    .map(([n,r]) => ({ n, cell: openestCell(dist, nx, ny, mRect(r)) }));

  /* start just inside the entry, at the most open cell of the threshold */
  const s = openestCell(dist, nx, ny, mRect(U.entryProbe(C, G)));
  if (!s) return targets.map(t => ({ room:t.n, widthIn:0 }));

  const out = targets.map(() => 0);
  for (let win = 48; win >= 14; win -= 2) {
    const half = (win/12)/2;
    if (s.clear < half) continue;
    const seen = new Uint8Array(nx*ny), st = [s.j*nx + s.i];
    seen[st[0]] = 1;
    while (st.length) {
      const k = st.pop(), i = k%nx, j = (k-i)/nx;
      for (let dj=-1;dj<=1;dj++) for (let di=-1;di<=1;di++){
        if (!di && !dj) continue;
        const ni=i+di, nj=j+dj;
        if (ni<0||nj<0||ni>=nx||nj>=ny) continue;
        const nk = nj*nx+ni;
        if (seen[nk] || dist[nk] < half) continue;
        seen[nk]=1; st.push(nk);
      }
    }
    targets.forEach((t,n) => {
      if (out[n] || !t.cell) return;
      if (seen[t.cell.j*nx + t.cell.i]) out[n] = win;
    });
    if (out.every(v=>v)) break;
  }
  return targets.map((t,n) => ({ room:t.n, widthIn:out[n] }));
}
/* the galley aisle is pure geometry — derived, not measured */

/* ══ area ══════════════════════════════════════════════════════════
   Net floor is rasterised at 1″ from the wall footprints the shell just
   emitted, so it stays honest when any dimension changes. Gross is the
   envelope inside the exterior walls; the difference is the partitions. */
function areaReport() {
  const keepFix = showFixtures, keepMode = wallMode;
  showFixtures = false; wallMode = 'cut';
  buildShell();                                   // fills wallRects
  showFixtures = keepFix; wallMode = keepMode;

  const S = 12, nx = Math.round(C.W*S), ny = Math.round(C.D*S);
  const g = new Uint8Array(nx*ny);                // 0 = outside, 1 = floor, 2 = wall
  const paint = ([x0,y0,x1,y1], v) => {
    const i0 = Math.max(0, Math.round(x0*S)), i1 = Math.min(nx, Math.round(x1*S));
    const j0 = Math.max(0, Math.round(y0*S)), j1 = Math.min(ny, Math.round(y1*S));
    for (let j=j0;j<j1;j++) for (let i=i0;i<i1;i++) g[j*nx+i] = v;
  };
  /* masked by the FOOTPRINT: an L-shaped plan has a notch of outdoors inside
     its bounding box, and counting that as floor inflates the net by its size */
  for (const r of U.footprint(C, G)) paint(mRect(r), 1);
  let gross = 0; for (let k=0;k<g.length;k++) if (g[k] === 1) gross++;
  for (const r of wallRects) paint(r, 2);
  let free = 0; for (let k=0;k<g.length;k++) if (g[k] === 1) free++;
  /* put the live blocker set back — callers downstream (fits, clearanceOK)
     read `blockers`, and the fixture-less build above would hide the casework */
  buildShell();
  const a = r => (r[2]-r[0])*(r[3]-r[1]);
  const gi = gross/(S*S);
  /* Gross BUILDING area — measured to the outside face of the exterior walls,
     which is what a listing quotes and what neither of the two numbers above
     is. For any rectilinear outline the exterior area is the interior plus
     perimeter × thickness plus one corner square per net convex corner; and a
     staircase-convex plan (a rectangle, or an L) has the perimeter of its own
     bounding box and exactly four net convex corners, so this holds for both
     plans without special-casing the L. Anything enclosed OUTSIDE the envelope
     — the closet stack in the bump-out — is the plan's to add.

     This is the number that reconciles Goldridge to its listed 650 sf. Do not
     conclude a listing is wrong by comparing it against interior clear. */
  const grossExt = gi + 2*(C.W + C.D)*C.wallExt + 4*C.wallExt*C.wallExt
                      + (U.bumpGross ? U.bumpGross(C, G) : 0);
  return {
    gross: gi, net: free/(S*S), grossExt,
    extras: U.areaExtras(C, G).map(([n, dims, r]) => [n, dims, a(r)]),
  };
}

/* ══ frame ═════════════════════════════════════════════════════════ */
let showDims = true, showLabels = true, showGrid = false, showClear = false;

function drawSelection() {
  const it = items.find(i => i.id === selId); if (!it) return;
  const sel = cssv('--sel'), c = corners(it), zb = (it.z || 0) + .04;
  for (let i=0;i<4;i++) seg3([...c[i],zb],[...c[(i+1)%4],zb], sel, 1.6);
  const mid = (a,b)=>[(a[0]+b[0])/2,(a[1]+b[1])/2,zb+.02];
  text3(mid(c[0],c[1]), [{ t:ftin(fW(it)), font:MONO(), color:sel }]);
  text3(mid(c[1],c[2]), [{ t:ftin(fD(it)), font:MONO(), color:sel }]);
}
/* the piece being dragged in from the catalog, before it exists */
let GHOSTITEM = null;
function drawGhost() {
  const it = GHOSTITEM, ok = placeable(it);
  const col = ok ? cssv('--sel') : cssv('--warn'), c = corners(it);
  for (let i=0;i<4;i++) seg3([...c[i],.05],[...c[(i+1)%4],.05], col, 1.6, ok ? null : [5,4]);
  const h = Math.max(fH(it), .25);
  for (let i=0;i<4;i++) seg3([...c[i],.05],[c[i][0],c[i][1],h], col, 1, [3,3]);
  const top = c.map(p => [p[0],p[1],h]);
  for (let i=0;i<4;i++) seg3(top[i], top[(i+1)%4], col, 1, [3,3]);
}

function drawClearances() {
  const warn = cssv('--warn'), ok = cssv('--ink-3');
  for (const it of items) {
    const cp = clearPoly(it); if (!cp) continue;
    const good = clearanceOK(it);
    for (let i=0;i<4;i++) seg3([...cp[i],.03],[...cp[(i+1)%4],.03], good?ok:warn, 1, [4,4]);
  }
}
function draw() {
  B = basis();
  SC = (VH/2) / Math.tan(RAD(cam.fov)/2);
  ctx.clearRect(0,0,VW,VH);
  buildShell();
  restack();
  for (const it of items) buildItem(it);
  if (GL) glBegin();
  paint(floorQuads, false);
  paint(quads, true);
  if (GL) glEnd();
  if (showGrid) drawGrid();
  if (showDims) drawDims();
  if (showClear) drawClearances();
  if (showLabels) drawLabels();
  drawSelection();
  if (GHOSTITEM) drawGhost();
  if (selId !== null && opts.onView) opts.onView();
}

/* ══ picking ═══════════════════════════════════════════════════════ */
function ray(sx, sy) {
  if (ORTHO) {
    const k = cam.dist / SC;
    const ox = -(sx - VW/2)*k, oy = -(sy - VH/2)*k;   // −X: see toScreen
    const o = [B.e[0]+B.r[0]*ox+B.u[0]*oy, B.e[1]+B.r[1]*ox+B.u[1]*oy, B.e[2]+B.r[2]*ox+B.u[2]*oy];
    return { o, d: B.f };
  }
  const nx = -(sx-VW/2)/SC, ny = -(sy-VH/2)/SC;        // −X: see toScreen
  return { o: B.e, d: norm([B.f[0]+B.r[0]*nx+B.u[0]*ny,
                            B.f[1]+B.r[1]*nx+B.u[1]*ny,
                            B.f[2]+B.r[2]*nx+B.u[2]*ny]) };
}
function hitFloor(r, z) {
  z = z || 0;
  if (Math.abs(r.d[2]) < 1e-6) return null;
  const t = (z - r.o[2]) / r.d[2];
  return t > 0 ? [r.o[0]+r.d[0]*t, r.o[1]+r.d[1]*t, z] : null;
}
function hitItem(r, it) {
  const a = RAD(it.rot), c = Math.cos(-a), s = Math.sin(-a);
  const ox = r.o[0]-it.x, oy = r.o[1]-it.y;
  const o = [ox*c-oy*s, ox*s+oy*c, r.o[2]];
  const d = [r.d[0]*c-r.d[1]*s, r.d[0]*s+r.d[1]*c, r.d[2]];
  const w = fW(it)/2, dp = fD(it)/2, h = Math.max(fH(it), .25), zb = it.z || 0;
  let t0 = 0, t1 = Infinity;
  const slab = (lo,hi,oi,di) => {
    if (Math.abs(di) < 1e-8) return oi >= lo && oi <= hi;
    let a1=(lo-oi)/di, b1=(hi-oi)/di; if (a1>b1) [a1,b1]=[b1,a1];
    t0=Math.max(t0,a1); t1=Math.min(t1,b1); return t1>=t0;
  };
  if (!slab(-w,w,o[0],d[0])) return null;
  if (!slab(-dp,dp,o[1],d[1])) return null;
  if (!slab(zb, zb+h, o[2], d[2])) return null;
  return t0 > 0 ? t0 : null;
}
function pick(sx, sy) {
  const r = ray(sx, sy); let best = null, bt = Infinity;
  for (const it of items) { const t = hitItem(r, it); if (t !== null && t < bt) { bt=t; best=it; } }
  return best;
}

/* ══ pointer + touch ═══════════════════════════════════════════════ */
let mode = null, last = null, dragOff = null, downAt = null, moved = false;
const touches = new Map();
let pinch0 = 0, dist0 = 0;

cv.addEventListener('pointerdown', ev => {
  cv.setPointerCapture(ev.pointerId);
  touches.set(ev.pointerId, [ev.clientX, ev.clientY]);
  if (touches.size === 2) {                       // pinch takes over
    const [a,b] = [...touches.values()];
    dist0 = Math.hypot(a[0]-b[0], a[1]-b[1]); pinch0 = cam.dist;
    mode = 'pinch'; return;
  }
  const r = cv.getBoundingClientRect();
  const sx = ev.clientX-r.left, sy = ev.clientY-r.top;
  last = [ev.clientX, ev.clientY];
  downAt = [ev.clientX, ev.clientY]; moved = false;
  if (ev.button === 0 && !ev.shiftKey) {
    const hit = pick(sx, sy);
    if (hit) {
      selId = hit.id; sync();
      const p = hitFloor(ray(sx,sy));
      dragOff = p ? [hit.x-p[0], hit.y-p[1]] : [0,0];
      mode = 'move'; cv.className = 'moving'; draw(); return;
    }
  }
  mode = (ev.button === 2 || ev.shiftKey) ? 'pan' : 'orbit';
  cv.className = 'grabbing'; draw();
});

cv.addEventListener('pointermove', ev => {
  if (!mode) return;
  if (touches.has(ev.pointerId)) touches.set(ev.pointerId, [ev.clientX, ev.clientY]);
  if (mode === 'pinch') {
    if (touches.size < 2) return;
    const [a,b] = [...touches.values()];
    const d = Math.hypot(a[0]-b[0], a[1]-b[1]);
    if (d > 4 && dist0 > 4) cam.dist = clamp(pinch0 * dist0/d, 9, 160);
    draw(); return;
  }
  const dx = ev.clientX-last[0], dy = ev.clientY-last[1];
  last = [ev.clientX, ev.clientY];
  if (downAt && Math.hypot(ev.clientX-downAt[0], ev.clientY-downAt[1]) > 3) moved = true;
  if (mode === 'orbit') {
    /* inverted: the drag turns the CAMERA, not the model — pull right and the
       viewpoint swings right, so the building appears to travel left */
    if (ORTHO) {
      cam.az += dx*0.34;
      cam.el = clamp(cam.el + dy*0.28, 4, 90);
      if (cam.el < OVERHEAD) leaveOrtho();
    } else {
      cam.az += dx*0.34;
      cam.el = clamp(cam.el + dy*0.28, 4, 88);
    }
  } else if (mode === 'pan') {
    const k = cam.dist*0.0016;
    cam.tx += (B.r[0]*dx + B.u[0]*dy)*k;
    cam.ty += (B.r[1]*dx + B.u[1]*dy)*k;
    cam.tx = clamp(cam.tx,-14,44); cam.ty = clamp(cam.ty,-14,44);
  } else if (mode === 'move') {
    const it = items.find(i => i.id === selId); if (!it) return;
    const r = cv.getBoundingClientRect();
    const p = hitFloor(ray(ev.clientX-r.left, ev.clientY-r.top));
    if (!p) return;
    let nx = p[0]+dragOff[0], ny = p[1]+dragOff[1];
    if (!ev.altKey) { nx = Math.round(nx*4)/4; ny = Math.round(ny*4)/4; }
    /* walls win: the pointer may go anywhere, the piece may not follow it
       through one. slide() takes it as far as it legally goes. */
    [it.x, it.y] = slide(it, nx, ny);
    save();
  }
  draw();
});
function endDrag(ev) {
  if (ev) touches.delete(ev.pointerId);
  if (mode === 'orbit' && !moved && selId !== null) { selId = null; }
  downAt = null;
  if (touches.size < 2 && mode === 'pinch') mode = null;
  if (mode) { mode = null; cv.className = ''; sync(); draw(); }
}
cv.addEventListener('pointerup', endDrag);
cv.addEventListener('pointercancel', endDrag);
cv.addEventListener('contextmenu', e => e.preventDefault());
cv.addEventListener('wheel', ev => {
  ev.preventDefault();
  cam.dist = clamp(cam.dist * Math.exp(ev.deltaY*0.0011), 9, 160);
  draw();
}, { passive:false });

addEventListener('keydown', ev => {
  if (/^(INPUT|TEXTAREA)$/.test(ev.target.tagName)) return;
  const it = items.find(i => i.id === selId);
  if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'z') {
    undo(); ev.preventDefault(); return;
  }
  if (ev.key === 'Escape') { selId = null; sync(); draw(); return; }
  if (!it) return;
  const step = ev.shiftKey ? 1 : 0.25;
  if (ev.key === 'Backspace' || ev.key === 'Delete') { remove(it.id); ev.preventDefault(); return; }
  /* nudges and rotations obey the same wall constraint as dragging —
     a rotation that would swing a piece into a wall is simply refused */
  const nudge = (dx, dy) => { [it.x, it.y] = slide(it, it.x + dx, it.y + dy); };
  const turn  = d => { const r = (it.rot + d + 360) % 360;
    if (!placeable(it) || freeAt(it, it.x, it.y, r)) it.rot = r; };
  const K = {
    ArrowLeft:()=>nudge(-step,0), ArrowRight:()=>nudge(step,0),
    ArrowUp:()=>nudge(0,-step),   ArrowDown:()=>nudge(0,step),
    r:()=>turn(15), R:()=>turn(-15),
  };
  if (K[ev.key]) { K[ev.key](); ev.preventDefault(); save(); sync(); draw(); }
});

/* ══ items ═════════════════════════════════════════════════════════ */
/* Seed each piece in the room it belongs to. Seeding from the camera target
   drops everything at the hall mouth, where it blocks circulation. */
const groupOf = k => { const g = CAT.find(g => g.items.some(i => i.k === k)); return g && g.g; };
function homeSeed(k) {
  const m = homeRect(k);
  return [(m[0]+m[2])/2, (m[1]+m[3])/2];
}
/* The walking spine — approaches to the front door, the vestibule and the
   bedroom door. Auto-placement stays out of these; you can still drag a piece
   in, and the circulation check will then tell you what it cost. */
function keepOut() {
  return U.keepOut(C, G).map(mRect);
}
/* the room a piece should stay inside if it can't find a clear spot */
function homeRect(k) {
  return mRect(U.seedRect(C, G, groupOf(k)));
}
function add(k) {
  pushUndo();
  const it = { id: nextId++, k, x: cam.tx, y: cam.ty, rot: 0 };
  const h = homeSeed(k), home = homeRect(k);
  /* The sweep used to cover the envelope alone, and the seed was clamped into
     it — so a piece whose home is the balcony got pulled indoors before the
     search even began, and no candidate out on the deck ever existed to find.
     Sweep the outdoor rect as well, and clamp the seed into the piece's own
     home rather than into the envelope. Indoor pieces are unaffected: their
     home is already inside, and the deck sweep only ever adds squares that
     inBounds() was willing to accept anyway. */
  const cl = (v, lo, hi) => hi - lo < 2 ? (lo + hi) / 2 : clamp(v, lo + 1, hi - 1);
  const seed = home ? [cl(h[0], home[0], home[2]), cl(h[1], home[1], home[3])]
                    : [clamp(h[0], 2, C.W - 2), clamp(h[1], 2, C.D - 2)];
  const cand = [];
  /* 3" steps: a queen in a 12′ bedroom can clear 24″ both sides by under an
     inch, and a coarser grid simply never lands on it. */
  const sweep = (x0, y0, x1, y1) => {
    for (let x=x0+.5;x<=x1-.5;x+=.25) for (let y=y0+.5;y<=y1-.5;y+=.25)
      cand.push([x,y,(x-seed[0])**2+(y-seed[1])**2]);
  };
  sweep(0, 0, C.W, C.D);
  const deck = mRect(U.outdoor(C, G));
  sweep(deck[0], deck[1], deck[2], deck[3]);
  cand.sort((a,b)=>a[2]-b[2]);
  /* Two passes: prefer somewhere the piece both fits AND keeps its declared
     clearance, so a new bed doesn't land jammed against a wall reporting FAIL.
     Fall back to merely fitting if the plan has no such spot. */
  items.push(it);
  const inHome = ([x,y]) => !home || (x > home[0] && x < home[2] && y > home[1] && y < home[3]);
  /* 1. somewhere it fits AND keeps its clearance
     2. failing that, somewhere it merely fits INSIDE ITS OWN ROOM — a queen
        that can't clear 24" both sides belongs in the bedroom flagged tight,
        not exiled to the living room where it technically has space
     3. failing that, anywhere it fits

     EVERY pass is room-first. The old order put the unrestricted "fully
     clear" test ahead of the in-room ones, so a queen that could not make
     its 24" both sides in the bedroom was placed in the living room instead
     — the exact outcome the comment above says to avoid. */
  const spine = keepOut();
  const clearOfSpine = () => { const p = corners(it);
    return !spine.some(r => overlapsRect(p, r)); };
  /* nothing lands on top of something already placed. Walls block by way of
     `blockers`, but items are not in there — without this every piece seeded
     to the same room stacks on the identical square. Rugs are exempt in both
     directions: they belong under the furniture. */
  const clearOfItems = () => {
    if (isFloorCover(it)) return true;
    const p = corners(it);
    for (const o of items) {
      if (o.id === it.id || isFloorCover(o)) continue;
      if (overlapsRect(p, bboxOf(o))) return false;
    }
    return true;
  };
  const base = () => fits(it) && clearOfItems();
  const inRoom = [
    ([x,y]) => inHome([x,y]) && base() && clearOfSpine() && clearanceOK(it) !== false,
    ([x,y]) => inHome([x,y]) && base() && clearOfSpine(),
    ([x,y]) => inHome([x,y]) && base(),
  ];
  const anywhere = [
    ()      => base() && clearOfSpine() && clearanceOK(it) !== false,
    ()      => base(),
    ()      => fits(it),
  ];
  /* Every in-room pass square-on, THEN every in-room pass turned 90°, and only
     then let the piece leave its room. Without the turn anything that fits its
     room only the long way falls straight through to "anywhere it fits": the
     balcony rug is 5′-3″ × 7′-7″ on a deck 5′-7½″ deep, so it was landing in
     the living room. Rotation is tried only after square-on has failed at every
     candidate in the room, so no placement that succeeds today can move. */
  const plan = [];
  for (const rot of [0, 90]) for (const t of inRoom) plan.push([rot, t]);
  for (const t of anywhere) plan.push([0, t]);
  let placed = false;
  for (const [rot, test] of plan) {
    it.rot = rot;
    for (const c of cand) { it.x=c[0]; it.y=c[1]; if (test(c)) { placed = true; break; } }
    if (placed) break;
  }
  if (!placed) it.rot = 0;
  selId = it.id; save(); sync(); draw();
}
function remove(id){
  pushUndo();
  items = items.filter(i=>i.id!==id); if (selId===id) selId=null; save(); sync(); draw();
}
function duplicate(id){
  const s = items.find(i=>i.id===id); if(!s) return;
  pushUndo();
  const it = {...s, id: nextId++, x: s.x+1, y: s.y+1};
  items.push(it); selId = it.id; save(); sync(); draw();
}

/* ══ persistence ═══════════════════════════════════════════════════
   TWO keys, deliberately.

   The LAYOUT — what you placed, and where — is your work, and it has to
   outlive every edit made to the model. The CONFIG is the plan itself, and
   its key gets versioned whenever CONFIG's shape changes, because load()
   merges a saved C over PLAN and a stale entry would silently resurrect an
   old envelope. Keeping both in one key is exactly why five earlier layouts
   were orphaned: each version bump stranded the furniture with it.

   Anything found under an old combined key is adopted once, items and camera
   only — never its C, which is the part that went stale.

   Keys are per PLAN, so arranging one apartment never disturbs the other.
   ══════════════════════════════════════════════════════════════════ */
const KP = opts.keyPrefix || 'apt.ui.';
const layoutKey = () => KP + U.id + '.layout';        // never versioned
const cfgKey    = () => KP + U.id + '.config.' + U.rev;   // bumped with CONFIG's shape
const LEGACY_KEYS = ['apt.parametric.unit14.v3', 'apt.parametric.unit14.v2',
                     'apt.parametric.unit14.v1', 'apt.parametric.a101.v1',
                     'apt.parametric.v2'];
let saveT = null, lastSaved = 0;
function save() {
  clearTimeout(saveT);
  /* capture the keys now: a plan switch between scheduling and firing must
     not write this apartment's furniture into the other one's key */
  const lk = layoutKey(), ck = cfgKey();
  const snap = JSON.stringify({ items, cam }), cfg = JSON.stringify({ C });
  saveT = setTimeout(() => {
    try {
      localStorage.setItem(lk, snap);
      localStorage.setItem(ck, cfg);
      localStorage.setItem(KP + 'plan', U.id);
      lastSaved = Date.now(); showSaved();
    } catch(e){ showSaved('Could not save — storage is blocked'); }
  }, 250);
  scheduleLinkedWrite();          // and into the linked file, more slowly
}
/* write immediately — used before switching plans, where a debounced write
   would land after the swap and target the wrong apartment */
function flushSave() {
  if (!saveT) return;
  clearTimeout(saveT); saveT = null;
  try {
    localStorage.setItem(layoutKey(), JSON.stringify({ items, cam }));
    localStorage.setItem(cfgKey(),    JSON.stringify({ C }));
  } catch(e){}
}
/* items only ever come back through here, so a hand-edited or stale file
   cannot inject a key the catalog does not have */
function applyLayout(d) {
  if (Array.isArray(d.items)) {
    items = d.items.filter(i => i && BYKEY[i.k]).map(i => ({
      id: +i.id || 0, k: i.k, x: +i.x || 0, y: +i.y || 0, rot: +i.rot || 0 }));
    items.forEach((i, n) => { if (!i.id) i.id = n + 1; });
    nextId = items.reduce((m,i) => Math.max(m, i.id), 0) + 1;
  }
  if (d.cam) Object.assign(cam, d.cam, { fov:36 });
}
/* Point the whole model at a plan: adopt its config and its saved layout.
   This is the only place U, C and G are assigned. */
function selectPlan(id) {
  if (U) flushSave();
  U = planById(id);
  C = { ...U.PLAN };
  items = []; selId = null; nextId = 1; undoStack = []; GHOSTITEM = null;
  try {
    const cfg = JSON.parse(localStorage.getItem(cfgKey()) || 'null');
    if (cfg && cfg.C) C = { ...U.PLAN, ...cfg.C };
  } catch(e){}
  G = U.derive(C);
  Object.assign(cam, VIEWS().iso);            // reframe for this envelope
  try {
    let lay = JSON.parse(localStorage.getItem(layoutKey()) || 'null');
    if ((!lay || !(lay.items || []).length) && U.legacy)
      for (const k of LEGACY_KEYS) {                 // rescue an orphan, once
        const d = JSON.parse(localStorage.getItem(k) || 'null');
        if (d && (d.items || []).length) { lay = { items: d.items }; break; }
      }
    if (lay) applyLayout(lay);
  } catch(e){}
}

/* ══ undo ══════════════════════════════════════════════════════════
   Clear-all used to be one click from losing an evening's arranging with
   no way back. Every mutation pushes the previous item list first. */
let undoStack = [];
function pushUndo() {
  undoStack.push(JSON.stringify(items));
  if (undoStack.length > 40) undoStack.shift();
}
function undo() {
  if (!undoStack.length) return;
  items = JSON.parse(undoStack.pop());
  selId = null; save(); sync(); draw();
}

/* ══ the project file ══════════════════════════════════════════════
   THE point of this section: localStorage is bound to the ORIGIN, not to
   the app. The same file opened from file://, from a local server and
   from a design preview gets three separate, empty stores — which reads
   as "it didn't save" when nothing was lost at all, it is just being
   looked for in the wrong drawer. It also dies with site data, never
   persists in a private window, and never follows you to another machine.

   So the durable copy is a FILE, and it holds the whole project — every
   apartment at once — rather than one apartment at a time. That is what
   makes it possible to close the tab and come back to all of the work
   instead of to whichever unit happened to be open.

   Layering, deliberately:
     · localStorage  — the working copy. Instant, zero effort, fragile.
     · the project file — the record. Manual, portable, durable.
   Neither replaces the other. ═══════════════════════════════════════ */
const PROJECT_FORMAT = 'iso-home-project';

/* One apartment's state. The live one comes from memory — it is ahead of
   storage by up to the 250ms save debounce — and the rest are read back
   out of their own keys, so a snapshot covers apartments that have not
   been opened this session. */
function planState(id) {
  const p = PLANS.find(x => x.id === id);
  if (!p) return null;
  if (U && id === U.id)
    return { C: { ...C }, cam: { ...cam }, items: items.map(i => ({ ...i })) };
  try {
    const lay = JSON.parse(localStorage.getItem(KP + id + '.layout') || 'null') || {};
    const cfg = JSON.parse(localStorage.getItem(KP + id + '.config.' + p.rev) || 'null');
    return {
      C: cfg && cfg.C ? { ...p.PLAN, ...cfg.C } : { ...p.PLAN },
      cam: lay.cam || null,
      items: Array.isArray(lay.items) ? lay.items : [],
    };
  } catch (e) { return { C: { ...p.PLAN }, cam: null, items: [] }; }
}

function snapshot() {
  flushSave();                       // the live apartment may be mid-debounce
  const plans = {};
  for (const p of PLANS) plans[p.id] = planState(p.id);
  return {
    format: PROJECT_FORMAT, version: 1,
    saved: new Date().toISOString(),
    activePlan: U.id,
    plans,
  };
}

/* Restore writes each apartment back into its own keys and then reselects,
   so everything re-enters through selectPlan → applyLayout. That matters:
   applyLayout filters items against BYKEY, so a hand-edited or out-of-date
   file still cannot inject a catalog key this build does not have. */
function restoreProject(doc) {
  if (!doc || doc.format !== PROJECT_FORMAT || !doc.plans)
    return { ok: false, reason: 'That file is not an Iso Home project.' };
  const restored = [], skipped = [];
  for (const id of Object.keys(doc.plans)) {
    const p = PLANS.find(x => x.id === id), st = doc.plans[id];
    if (!p || !st) { skipped.push(id); continue; }
    try {
      localStorage.setItem(KP + id + '.layout', JSON.stringify({
        items: Array.isArray(st.items) ? st.items : [], cam: st.cam || undefined }));
      if (st.C) localStorage.setItem(KP + id + '.config.' + p.rev, JSON.stringify({ C: st.C }));
      restored.push(p.name);
    } catch (e) { skipped.push(id); }
  }
  if (!restored.length)
    return { ok: false, reason: 'That project has no apartments this build can draw.' };
  const want = doc.activePlan && PLANS.some(p => p.id === doc.activePlan)
    ? doc.activePlan : PLANS[0].id;
  U = null;                          // force a reload even if it is the same plan
  selectPlan(want);
  sync(); draw();
  glide(VIEWS().iso, 1);
  return { ok: true, restored, skipped };
}

/* Is the working copy actually working? When storage is blocked — a
   sandboxed frame, a private window, a full quota — autosave fails
   silently and the first you would know is losing an evening's work.
   The UI surfaces this, so the answer has to be checkable up front. */
function storageOK() {
  try {
    const k = KP + '__probe';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return true;
  } catch (e) { return false; }
}

/* ══ the LINKED project file ═══════════════════════════════════════
   The project file above still asks you to remember to save it. This
   removes that: adopt a real file once, and every change writes straight
   back into it. The file becomes the save state; localStorage drops to
   being a cache in front of it.

   File System Access only. Chrome and Edge have it; Safari and Firefox do
   not, and a cross-origin iframe is refused a picker even in Chrome — so
   every entry point feature-detects, and every failure falls back to the
   download path rather than pretending.

   THE RULE ON RESUME: when a linked file is reattached, the FILE wins and
   is restored over whatever is in localStorage. It is written within
   ~1.2s of every change and again on pagehide, so it is never meaningfully
   behind — and this is the one behaviour that survives the cache being
   cleared, which is the whole reason the link exists. The alternative
   (browser wins) would quietly overwrite a good file with an empty state
   the first time site data was cleared. ═══════════════════════════════ */
const FSA = typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function';
let fileHandle = null, fileName = '', linkState = FSA ? 'off' : 'unsupported';
let fileT = null, writingFile = false, writeAgain = false;

/* A FileSystemFileHandle is structured-cloneable but not JSON, so it
   cannot live in localStorage — IndexedDB is the only place to keep it. */
function idbStore(mode, fn) {
  return new Promise((res, rej) => {
    let rq;
    try { rq = indexedDB.open('iso-home', 1); } catch (e) { return rej(e); }
    rq.onupgradeneeded = () => rq.result.createObjectStore('handles');
    rq.onerror = () => rej(rq.error);
    rq.onsuccess = () => {
      const db = rq.result;
      const tx = db.transaction('handles', mode);
      const out = fn(tx.objectStore('handles'));
      tx.oncomplete = () => { db.close(); res(out && out.result !== undefined ? out.result : undefined); };
      tx.onerror = () => { db.close(); rej(tx.error); };
    };
  });
}
const handleSave = h => idbStore('readwrite', st => st.put(h, 'project'));
const handleLoad = ()  => idbStore('readonly',  st => st.get('project'));
const handleDrop = ()  => idbStore('readwrite', st => st.delete('project'));

async function writeLinked() {
  if (!fileHandle) return;
  if (writingFile) { writeAgain = true; return; }
  writingFile = true;
  try {
    const w = await fileHandle.createWritable();
    await w.write(JSON.stringify(snapshot(), null, 1));
    await w.close();
    if (linkState !== 'linked') { linkState = 'linked'; sync(); }
  } catch (e) {
    /* moved, deleted, or permission withdrawn — say so rather than
       failing silently, because the file is the save state now */
    linkState = 'reconnect'; sync();
    showSaved('Could not write ' + fileName + ' — reconnect to keep saving');
  } finally {
    writingFile = false;
    if (writeAgain) { writeAgain = false; scheduleLinkedWrite(); }
  }
}
/* Slower than the 250ms localStorage debounce: this touches the disk, and
   dragging a sofa across a room should not write the file forty times. */
function scheduleLinkedWrite() {
  if (!fileHandle || linkState !== 'linked') return;
  clearTimeout(fileT);
  fileT = setTimeout(writeLinked, 1200);
}

/* Must be called straight from a click — the picker needs the user
   gesture, so nothing may be awaited before it. */
async function linkFile() {
  if (!FSA) return { ok: false, reason: 'This browser cannot link a file. Use Save project instead.' };
  let h;
  try {
    h = await window.showSaveFilePicker({
      suggestedName: 'iso-home.json',
      types: [{ description: 'Iso Home project', accept: { 'application/json': ['.json'] } }],
    });
  } catch (e) {
    if (e && e.name === 'AbortError') return { ok: false, cancelled: true };
    return { ok: false, reason: 'This page is not allowed to open a file picker — that is usually a preview frame. Use Save project instead.' };
  }
  fileHandle = h; fileName = h.name; linkState = 'linked';
  try { await handleSave(h); } catch (e) {}
  await writeLinked();
  sync();
  return { ok: true, name: fileName };
}

/* Open an existing project AND adopt it, in one step */
async function openLinked() {
  if (!FSA) return { ok: false, reason: 'This browser cannot link a file. Use Open project instead.' };
  let h;
  try {
    const picked = await window.showOpenFilePicker({
      multiple: false,
      types: [{ description: 'Iso Home project', accept: { 'application/json': ['.json'] } }],
    });
    h = picked[0];
  } catch (e) {
    if (e && e.name === 'AbortError') return { ok: false, cancelled: true };
    return { ok: false, reason: 'This page is not allowed to open a file picker — that is usually a preview frame. Use Open project instead.' };
  }
  const res = await adoptHandle(h);
  if (res.ok) { try { await handleSave(h); } catch (e) {} }
  return res;
}

/* Read a handle's contents and restore from them — the shared path for
   opening a file and for reattaching to one on the next visit. */
async function adoptHandle(h) {
  let doc = null;
  try { doc = JSON.parse(await (await h.getFile()).text()); }
  catch (e) { return { ok: false, reason: 'That file could not be read.' }; }
  const res = restoreProject(doc);
  if (!res.ok) return res;
  fileHandle = h; fileName = h.name; linkState = 'linked';
  sync();
  return { ok: true, name: h.name, restored: res.restored };
}

/* On boot: silently reattach if the permission is still granted, and
   otherwise surface a Reconnect button — requestPermission needs a
   gesture, so it cannot happen here. */
async function resumeLink() {
  if (!FSA) return;
  let h = null;
  try { h = await handleLoad(); } catch (e) { return; }
  if (!h) return;
  fileHandle = h; fileName = h.name || 'iso-home.json';
  let perm = 'prompt';
  try { perm = await h.queryPermission({ mode: 'readwrite' }); } catch (e) {}
  if (perm === 'granted') {
    const res = await adoptHandle(h);
    if (res.ok) { showSaved('Restored from ' + fileName); return; }
    linkState = 'reconnect';
  } else {
    linkState = 'reconnect';
  }
  sync();
}

async function reconnectLink() {
  if (!fileHandle) return { ok: false, reason: 'There is no linked file to reconnect to.' };
  let perm = 'denied';
  try { perm = await fileHandle.requestPermission({ mode: 'readwrite' }); } catch (e) {}
  if (perm !== 'granted') { sync(); return { ok: false, reason: 'Permission refused — the file stays disconnected.' }; }
  const res = await adoptHandle(fileHandle);
  if (res.ok) showSaved('Reconnected to ' + fileName);
  return res;
}

async function unlinkFile() {
  clearTimeout(fileT);
  fileHandle = null; fileName = ''; linkState = FSA ? 'off' : 'unsupported';
  try { await handleDrop(); } catch (e) {}
  sync();
  return { ok: true };
}

/* ══ layout files ══════════════════════════════════════════════════
   One apartment at a time, kept alongside the project file: handy for
   trying a second arrangement of the same room, or handing one unit's
   layout to someone else without sending the whole shortlist. */
function saveLayoutFile() {
  const doc = {
    format: 'unit-model-layout', version: 2,
    unit: U.id, sheet: U.sub, interior: U.envelope(C, G),
    C, cam, items,
  };
  const name = `${U.id}-layout.json`;
  grab(name, JSON.stringify(doc, null, 1), 'application/json');
  showSaved('Layout written to ' + name);
}
function saveProjectFile() {
  const doc = snapshot();
  const n = Object.keys(doc.plans).length;
  grab('iso-home.json', JSON.stringify(doc, null, 1), 'application/json');
  showSaved(`Project written to iso-home.json — ${n} apartment${n === 1 ? '' : 's'}`);
  return doc;
}
function loadProjectFile(file) {
  const r = new FileReader();
  r.onload = () => {
    let d = null;
    try { d = JSON.parse(r.result); } catch (e) {}
    /* a single-apartment layout is a reasonable thing to drop here by
       mistake — take it rather than refusing, since it is unambiguous */
    if (d && d.format === 'unit-model-layout') { loadLayoutDoc(d); return; }
    const res = restoreProject(d);
    showSaved(res.ok
      ? `Project restored — ${res.restored.join(', ')}`
      : res.reason);
  };
  r.readAsText(file);
}
function loadLayoutDoc(d) {
  if (!d || !Array.isArray(d.items)) { showSaved('That file is not a saved layout'); return; }
  /* a layout belongs to the plan it was arranged in — loading one
     apartment's positions into another scatters them through walls */
  if (d.unit && d.unit !== U.id) {
    const o = PLANS.find(p => p.id === d.unit);
    showSaved(o ? `That layout is for ${o.name} — switch apartments first`
                : 'That layout is for an apartment this model does not have');
    return;
  }
  pushUndo();
  if (d.C) { C = { ...U.PLAN, ...d.C }; G = U.derive(C); }
  applyLayout(d);
  selId = null; save(); sync(); draw();
  showSaved(`Loaded ${items.length} piece${items.length === 1 ? '' : 's'}`);
}
function loadLayoutFile(file) {
  const r = new FileReader();
  r.onload = () => {
    let d = null;
    try { d = JSON.parse(r.result); } catch(e){}
    loadLayoutDoc(d);
  };
  r.readAsText(file);
}
/* A real message ("Loaded 3 pieces", "Cleared") outranks the routine "Saved"
   for a couple of seconds — otherwise the debounced autosave fires 250ms
   later and overwrites the thing the user actually needed to read. */
function showSaved(msg){ if (opts.onStatus) opts.onStatus(msg || 'Saved'); }
function sync(){ if (opts.onChange) opts.onChange(); }

const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
let anim = null;
function glide(to, ms) {
  cancelAnimationFrame(anim);
  if (REDUCED) { Object.assign(cam, to); draw(); save(); return; }
  const from = { az:cam.az, el:cam.el, dist:cam.dist, tx:cam.tx, ty:cam.ty, tz:cam.tz };
  let daz = to.az - from.az;
  while (daz > 180) daz -= 360; while (daz < -180) daz += 360;
  const t0 = performance.now(), dur = ms || 620;
  (function step(t){
    const k = Math.min(1,(t-t0)/dur), e = 1-Math.pow(1-k,3);
    cam.az = from.az + daz*e;
    for (const p of ['el','dist','tx','ty','tz']) cam[p] = from[p] + ((to[p] ?? from[p]) - from[p])*e;
    draw();
    if (k < 1) anim = requestAnimationFrame(step); else save();
  })(t0);
}

/* Headless hook — export-3d.mjs drives these under a stubbed DOM so the
   files can be regenerated from the command line without opening the page. */
globalThis.__unitModel = { buildOBJ, buildMTL, buildGLTF, config: () => ({ ...C }) };



/* ══════════════════════════════════════════════════════════════════
   HOST API — everything the interface needs and nothing about how it
   looks. The panels that used to live in here are markup in the
   .dc.html now; this returns the data they render.
   ══════════════════════════════════════════════════════════════════ */
function grab(name, text, mime) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const el = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(el); el.click(); el.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

const grade = (v, min, good) => v >= (good == null ? min : good) ? 'pass' : v >= min ? 'tight' : 'fail';

function fitData() {
  buildShell(); restack(); for (const it of items) buildItem(it);
  const probs = U.problems(C, G);
  const routes = widestRoutes(), gap = sofaCoffeeGap();
  const R = (label, val, state, note) => ({ label, val, state, note: note || '' });
  /* the plan-specific half: what the dimensions alone already decide,
     before any furniture is placed */
  const sections = U.fit(C, G, R, grade);

  sections.push({ title: 'Circulation — narrowest point en route', rows: routes.map(r => r.widthIn
    ? R(r.room, r.widthIn + '″', grade(r.widthIn, 30, 36),
        r.widthIn < 36 && r.widthIn >= 30 ? 'Doorway-width pinch. Normal, but nothing bulky passes.' : '')
    : R(r.room, 'blocked', 'fail', 'No route wide enough to walk. Something is in the way.')) });

  const rules = items.filter(i => spec(i).clr);
  const per = rules.map(it => {
    const ok = clearanceOK(it), S = spec(it);
    const sides = S.clr.map((v, i) => v ? `${v}″ ${['behind','right','in front','left'][i]}` : null)
                       .filter(Boolean).join(', ');
    return R(S.n, ok ? 'clear' : 'obstructed', ok ? 'pass' : 'fail',
      ok ? '' : `Wants ${sides}. Something is inside that.`);
  });
  if (gap !== null) {
    const st = gap >= 16 && gap <= 18 ? 'pass' : (gap >= 12 && gap <= 24 ? 'tight' : 'fail');
    per.push(R('Sofa to coffee table', Math.round(gap) + '″', st,
      st === 'pass' ? '' : "Wants 16–18″. Closer is a shin-barker, further and you can't reach it."));
  }
  sections.push({ title: 'Per-piece clearance', rows: per,
    empty: per.length ? '' : 'Add a bed, sofa or dining table — those carry clearance rules and will report here.' });

  const A = areaReport(), sch = scheduled();
  const areaRows = roomList().filter(([n]) => sch.includes(n)).map(([n, r]) => ({
    label: n, size: `${ftin(r[2]-r[0])} × ${ftin(r[3]-r[1])}`,
    sf: Math.round((r[2]-r[0]) * (r[3]-r[1])) + ' sf', strong: false }));
  areaRows.push({ label: 'Gross building', size: 'to the outside of the exterior walls', sf: A.grossExt.toFixed(0) + ' sf', strong: false });
  areaRows.push({ label: 'Gross interior', size: U.envelope(C, G), sf: A.gross.toFixed(0) + ' sf', strong: false });
  areaRows.push({ label: 'Net floor', size: `less ${(A.gross - A.net).toFixed(0)} sf partitions`, sf: A.net.toFixed(0) + ' sf', strong: true });
  for (const [n, dims, sf] of A.extras)
    areaRows.push({ label: n, size: dims, sf: sf.toFixed(0) + ' sf', strong: false });

  return { problems: probs, sections, areaRows, area: A,
    footnote: U.areaNote(C, G, A) };
}

const API = {
  canvas: cv,
  draw, resize, ftin,
  config: () => ({ ...C }),
  /* the config pane is authored per plan: a patio unit has no stair rows
     and an L-shaped one has a dining bay the other does not */
  configSections: () => U.fields.map(f => ({
    title: f.t, note: f.note || '',
    rows: f.rows.map(([k, label]) => ({ k, label, value: +C[k].toFixed(4) })),
  })),
  constants: () => U.constants,
  resetLabel: () => U.resetLabel,
  derived: () => U.derived(C, G)
    .map(([label, v, f]) => ({ label, formula: f, value: ftin(v) })),
  setConfig(k, v) { if (!isFinite(v) || v <= 0) return; C = { ...C, [k]: v }; G = U.derive(C); save(); sync(); draw(); },
  resetConfig() { C = { ...U.PLAN }; G = U.derive(C); save(); sync(); draw(); },
  setMirror(m) { C = { ...C, mirror: !!m }; save(); sync(); draw(); },
  mirrored: () => !!C.mirror,
  setWallMode(m) { wallMode = m; draw(); },
  setOrtho(v) { ORTHO = !!v; if (v) glide({ ...cam, az: 90, el: 90, tz: 0 }); else draw(); },
  goView(k) {
    const v = VIEWS()[k];
    if (v.el < OVERHEAD) leaveOrtho();
    glide(v);
  },
  setFlag(k, v) {
    if (k === 'fix') showFixtures = v; else if (k === 'dim') showDims = v;
    else if (k === 'lab') showLabels = v; else if (k === 'grid') showGrid = v;
    else if (k === 'clr') showClear = v;
    draw();
  },
  setUnits(u) { UNITS = u === 'm' ? 'm' : 'ft'; draw(); sync(); },
  catalog: () => CAT.map(g => ({ g: g.g, items: g.items.map(it => ({ k: it.k, n: it.n, d: it.w + '×' + it.d })) })),
  placed() {
    return items.map(it => {
      const S = spec(it);
      return { id: it.id, name: S.n, dims: S.w + '×' + S.d + '×' + S.h + '″',
        flag: !fits(it) ? 'blocked' : clearanceOK(it) === false ? 'tight' : '',
        selected: it.id === selId };
    });
  },
  coverage() {
    const a = items.reduce((s, it) => s + (isFloorCover(it) ? 0 : fW(it) * fD(it)), 0);
    /* against NET floor, not the bounding box — an L-shaped plan's box
       includes a notch of outdoors and would understate every percentage */
    const net = areaReport().net || (C.W * C.D);
    return { sf: a.toFixed(0), pct: (a / net * 100).toFixed(0) };
  },
  count: () => items.length,
  add, remove, duplicate, undo,
  /* Dropping a piece in from the catalog. The pointer names the spot; if that
     spot is inside a wall or a fixture the nearest legal one within 3′ wins,
     so a drop that lands half in the counter slides clear instead of failing. */
  spotFor(k, sx, sy) {
    if (!BYKEY[k]) return null;
    const p = hitFloor(ray(sx, sy));
    if (!p) return null;
    const probe = { id: -1, k, x: Math.round(p[0]*4)/4, y: Math.round(p[1]*4)/4, rot: 0 };
    if (placeable(probe)) return probe;
    for (let r = 0.25; r <= 3; r += 0.25) {
      for (let a = 0; a < 16; a++) {
        const t = a / 16 * Math.PI * 2;
        const q = { ...probe, x: probe.x + Math.cos(t)*r, y: probe.y + Math.sin(t)*r };
        q.x = Math.round(q.x*4)/4; q.y = Math.round(q.y*4)/4;
        if (placeable(q)) return q;
      }
    }
    return probe;                                  // nowhere clear — show it blocked
  },
  ghostAt(k, sx, sy) {
    const s = this.spotFor(k, sx, sy);
    GHOSTITEM = s; draw();
    return !!s && placeable(s);
  },
  clearGhost() { if (GHOSTITEM) { GHOSTITEM = null; draw(); } },
  dropAt(k, sx, sy) {
    const s = this.spotFor(k, sx, sy);
    GHOSTITEM = null;
    if (!s) { draw(); return null; }
    pushUndo();
    const it = { id: nextId++, k, x: s.x, y: s.y, rot: 0 };
    items.push(it); selId = it.id;
    save(); sync(); draw();
    if (!placeable(it)) showSaved('Dropped there, but it overlaps — nudge it clear');
    return it.id;
  },
  select(id) { selId = id; sync(); draw(); },
  /* top-centre of the selected piece's bounding box, in canvas CSS px */
  selectionScreen() {
    const it = items.find(i => i.id === selId);
    if (!it) return null;
    const c = corners(it), zb = it.z || 0, h = zb + Math.max(fH(it), .25);
    let sx = 0, top = Infinity, n = 0;
    for (const p of c) for (const z of [zb, h]) {
      const cc = toCam([p[0], p[1], z]);
      if (cc[2] < NEAR) continue;
      const s = toScreen(cc);
      sx += s[0]; n++;
      if (s[1] < top) top = s[1];
    }
    return n ? { x: sx / n, y: top, w: VW, h: VH } : null;
  },
  selection() {
    const it = items.find(i => i.id === selId);
    if (!it) return null;
    const S = spec(it);
    return { id: it.id, name: S.n, w: ftin(fW(it)), d: ftin(fD(it)), h: ftin(fH(it)),
             rot: it.rot, blocked: !fits(it) };
  },
  rotate(d) {
    const it = items.find(i => i.id === selId); if (!it) return;
    const r = (it.rot + d + 360) % 360;
    if (!placeable(it) || freeAt(it, it.x, it.y, r)) it.rot = r;
    else showSaved('A wall is in the way of that turn');
    save(); sync(); draw();
  },
  clearAll() { pushUndo(); items = []; selId = null; save(); sync(); draw(); showSaved('Cleared — Undo brings it back'); },
  listText: () => items.map(it => { const S = spec(it); return `${S.n}\t${S.w}" W x ${S.d}" D x ${S.h}" H`; }).join('\n'),
  fit: fitData,
  area: areaReport,
  /* the apartments this model can draw, and which one is live. The UI's
     shortlist carries entries with no plan behind them too — those are
     uploads waiting to be modelled, and they are not in here. */
  plans: () => PLANS.map(p => ({ id: p.id, name: p.name, tag: p.tag, sub: p.sub, handed: !!p.handed })),
  plan: () => ({ id: U.id, name: U.name, tag: U.tag, sub: U.sub, handed: !!U.handed }),
  selectPlan(id) {
    if (!PLANS.some(p => p.id === id) || id === U.id) return false;
    selectPlan(id);
    sync(); draw();
    glide(VIEWS().iso, 1);
    return true;
  },
  exportOBJ() { grab(U.id + '.obj', buildOBJ(), 'model/obj'); grab(U.id + '.mtl', buildMTL(), 'model/mtl'); draw(); },
  exportGLTF() { grab(U.id + '.gltf', buildGLTF(), 'model/gltf+json'); draw(); },
  saveLayoutFile, loadLayoutFile,
  /* the whole project — every apartment in one document */
  saveProjectFile, loadProjectFile,
  snapshot,
  restoreProject,
  /* the linked file — adopt one and the app saves into it by itself */
  linkFile, openLinked, reconnectLink, unlinkFile,
  link: () => ({ supported: FSA, state: linkState, name: fileName }),
  /* what the save state currently holds, for the UI to show back */
  project: () => ({
    storage: storageOK(),
    where: (() => { try { return location.origin === 'null' ? 'this file' : location.origin; }
                    catch (e) { return 'this browser'; } })(),
    apartments: PLANS.map(p => {
      const st = planState(p.id);
      return { id: p.id, name: p.name, pieces: st ? st.items.length : 0,
               active: !!U && p.id === U.id };
    }),
  }),
  destroy() {
    flushSave();                                   // never tear down over unsaved work
    try { ro.disconnect(); } catch (e) {}
    try { removeEventListener('pagehide', onHide); } catch (e) {}
    if (glcv) glcv.remove();
  },
};

UNITS = opts.units === 'm' ? 'm' : 'ft';
if (opts.wallMode) wallMode = opts.wallMode;
if (opts.ortho) ORTHO = true;
initGL();
selectPlan(opts.plan || localStorage.getItem(KP + 'plan') || PLANS[0].id);
const ro = new ResizeObserver(resize);
ro.observe(cv);
/* Saves are debounced 250ms, so closing the tab right after moving a piece
   would drop that last move. `pagehide` is the one event that fires
   reliably on close, navigation and on iOS going to the background —
   `beforeunload` and `unload` both miss the mobile cases. */
const onHide = () => { flushSave(); if (fileHandle && linkState === 'linked') writeLinked(); };
addEventListener('pagehide', onHide);
addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSave(); });
resize();
if (opts.view && VIEWS()[opts.view]) glide(VIEWS()[opts.view], 1);
/* after first paint, not before: this is async, and the model must be
   usable from localStorage while the handle is being re-permissioned */
resumeLink();
return API;

}

window.UnitModel = { create: createUnitModel };
})();
