// Pruebas sin dependencias con el runner integrado de Node.
// Ejecutar con: node --test tests/
//
// Los scripts del juego son globales de navegador, asi que se cargan en un
// contexto de VM con un `performance.now` controlable desde cada prueba.

'use strict';

const test = require( 'node:test' );
const assert = require( 'node:assert/strict' );
const fs = require( 'node:fs' );
const path = require( 'node:path' );
const vm = require( 'node:vm' );

const ROOT = path.resolve( __dirname, '..' );
const FILES = {
  maze: path.join( ROOT, 'src/js/maze.js' ),
  game: path.join( ROOT, 'src/js/game.js' ),
  render: path.join( ROOT, 'src/js/render.js' ),
};

function makeSandbox( now ) {
  const sandbox = { console, Math, performance: { now } };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext( sandbox );
  return sandbox;
}

function run( sandbox, file ) {
  const source = fs.readFileSync( file, 'utf8' );
  vm.runInContext( source, sandbox, { filename: file } );
}

// Carga maze.js + game.js y expone las funciones internas para probarlas.
function loadGame( now = () => 0 ) {
  const sandbox = makeSandbox( now );
  run( sandbox, FILES.maze );
  run( sandbox, FILES.game );
  vm.runInContext(
    `window.__t = {
      createGame, update, targetFor, insidePen, advancePhase, resetPositions,
      decideGhost, moveGhost, collides,
      GHOST_STARTS, GHOST_CORNERS, SCATTER_MS, CHASE_MS,
      PINKY_LEAD, INKY_LEAD, CLYDE_PANIC_DISTANCE
    };`,
    sandbox
  );
  return sandbox.__t;
}

// Carga el juego completo (incluido render.js) y expone lo necesario.
function loadRender( now = () => 0 ) {
  const sandbox = makeSandbox( now );
  run( sandbox, FILES.maze );
  run( sandbox, FILES.game );
  run( sandbox, FILES.render );
  vm.runInContext( `window.__r = { GHOST_COLORS, draw, createGame };`, sandbox );
  return sandbox.__r;
}

// Canvas falso que registra los colores usados en cada fill().
function fakeCtx() {
  return {
    fills: [],
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    lineCap: '',
    lineJoin: '',
    font: '',
    textBaseline: '',
    textAlign: '',
    fillRect() {},
    beginPath() {},
    closePath() {},
    stroke() {},
    fill() {
      this.fills.push( this.fillStyle );
    },
    moveTo() {},
    lineTo() {},
    arc() {},
    fillText() {},
  };
}

test( 'GHOST_STARTS define los cuatro fantasmas con identidad fija', () => {
  const t = loadGame();
  assert.deepEqual(
    Array.from( t.GHOST_STARTS, ( g ) => [ g.x, g.y, g.kind ] ),
    [
      [ 13, 14, 'blinky' ],
      [ 14, 14, 'pinky' ],
      [ 12, 13, 'inky' ],
      [ 15, 13, 'clyde' ],
    ]
  );
} );

test( 'createGame arranca en scatter con los cuatro fantasmas en la pen', () => {
  const t = loadGame();
  const game = t.createGame();

  assert.equal( game.ghosts.length, 4 );
  assert.equal( game.phase, 'scatter' );
  assert.equal( game.phaseTimeMs, 0 );
  assert.deepEqual(
    Array.from( game.ghosts, ( g ) => g.kind ),
    [ 'blinky', 'pinky', 'inky', 'clyde' ]
  );
  for ( const g of game.ghosts ) {
    assert.equal( t.insidePen( g ), true, g.kind + ' debe empezar en la pen' );
  }
} );

test( 'targetFor aplica la personalidad de cada fantasma en chase', () => {
  const t = loadGame();
  const game = t.createGame();
  game.phase = 'chase';
  game.pacman.x = 10;
  game.pacman.y = 20;
  game.pacman.dir = 'right';

  // Fuera de la pen para que no aplique la regla de salida.
  for ( const g of game.ghosts ) {
    g.x = 5;
    g.y = 20;
  }
  const blinky = game.ghosts[ 0 ];

  const blinkyTarget = t.targetFor( game, blinky );
  assert.equal( blinkyTarget.x, 10 );
  assert.equal( blinkyTarget.y, 20 );

  const pinkyTarget = t.targetFor( game, game.ghosts[ 1 ] );
  assert.equal( pinkyTarget.x, 10 + t.PINKY_LEAD );
  assert.equal( pinkyTarget.y, 20 );

  const inkyTarget = t.targetFor( game, game.ghosts[ 2 ] );
  assert.equal( inkyTarget.x, 2 * ( 10 + t.INKY_LEAD ) - 5 );
  assert.equal( inkyTarget.y, 20 );

  // clyde persigue a mas de 8 celdas y se retira a 8 o menos.
  const clyde = game.ghosts[ 3 ];
  clyde.x = 1;
  clyde.y = 20;
  assert.equal( t.targetFor( game, clyde ).x, 10 );

  clyde.x = 2;
  const near = t.targetFor( game, clyde );
  assert.equal( near.x, 1 );
  assert.equal( near.y, 29 );
} );

test( 'inky flanquea usando a blinky y cambia si blinky se mueve', () => {
  const t = loadGame();
  const game = t.createGame();
  game.phase = 'chase';
  game.pacman.x = 10;
  game.pacman.y = 20;
  game.pacman.dir = 'right';

  const blinky = game.ghosts[ 0 ];
  const inky = game.ghosts[ 2 ];
  inky.x = 5;
  inky.y = 20;
  blinky.x = 2;
  blinky.y = 20;
  const first = t.targetFor( game, inky );

  blinky.x = 4;
  const second = t.targetFor( game, inky );

  assert.notEqual( first.x, second.x );
} );

test( 'inky usa la celda de Pac-Man si no existe blinky', () => {
  const t = loadGame();
  const game = t.createGame();
  game.phase = 'chase';
  game.pacman.x = 10;
  game.pacman.y = 20;
  game.pacman.dir = 'up';
  game.ghosts = game.ghosts.filter( ( g ) => g.kind !== 'blinky' );

  const inky = game.ghosts.find( ( g ) => g.kind === 'inky' );
  inky.x = 5;
  inky.y = 20;
  const target = t.targetFor( game, inky );
  assert.equal( target.x, 10 );
  assert.equal( target.y, 20 );
} );

test( 'en scatter cada fantasma apunta a su propia esquina', () => {
  const t = loadGame();
  const game = t.createGame();
  game.phase = 'scatter';
  // Fuera de la pen: la regla de salida tiene prioridad dentro de ella.
  for ( const g of game.ghosts ) {
    g.x = 10;
    g.y = 10;
  }

  const keys = Array.from( game.ghosts, ( g ) => {
    const target = t.targetFor( game, g );
    const corner = t.GHOST_CORNERS[ g.kind ];
    assert.equal( target.x, corner.x, g.kind + ' x' );
    assert.equal( target.y, corner.y, g.kind + ' y' );
    return target.x + ',' + target.y;
  } );
  assert.equal( new Set( keys ).size, 4 );
} );

test( 'un fantasma en la pen apunta por encima de la puerta para salir', () => {
  const t = loadGame();
  const game = t.createGame();

  assert.equal( t.insidePen( { x: 13, y: 14 } ), true );
  assert.equal( t.insidePen( { x: 13, y: 12 } ), true );
  assert.equal( t.insidePen( { x: 13, y: 11 } ), false );
  assert.equal( t.insidePen( { x: 10, y: 14 } ), false );

  const target = t.targetFor( game, game.ghosts[ 0 ] );
  assert.equal( target.x, 13 );
  assert.equal( target.y, 11 );
} );

test( 'decideGhost no invierte 180 grados ni al cambiar de fase', () => {
  const t = loadGame();
  const game = t.createGame();
  const ghost = game.ghosts[ 0 ];
  ghost.x = 6;
  ghost.y = 5;
  ghost.dir = 'right';
  game.pacman.x = 1;
  game.pacman.y = 5;
  game.pacman.dir = 'right';

  game.phase = 'chase';
  t.decideGhost( game, ghost );
  assert.notEqual( ghost.dir, 'left' );

  game.phase = 'scatter';
  ghost.dir = 'right';
  t.decideGhost( game, ghost );
  assert.notEqual( ghost.dir, 'left' );
} );

test( 'decideGhost permite el giro de 180 solo en un callejon sin salida', () => {
  const t = loadGame();
  const game = t.createGame();
  game.grid[ 0 ][ 1 ] = 1;
  game.grid[ 1 ][ 0 ] = 1;
  game.grid[ 1 ][ 2 ] = 1;
  game.grid[ 2 ][ 1 ] = 0;

  const ghost = game.ghosts[ 0 ];
  ghost.x = 1;
  ghost.y = 1;
  ghost.dir = 'up';
  game.pacman.x = 13;
  game.pacman.y = 23;

  t.decideGhost( game, ghost );
  assert.equal( ghost.dir, 'down' );
} );

test( 'advancePhase alterna 7 s de scatter y 20 s de chase', () => {
  let now = 0;
  const t = loadGame( () => now );
  const game = t.createGame();

  // Avanza en tramos de como maximo 100 ms, igual que el cap real.
  const advance = ( ms ) => {
    while ( ms > 0 ) {
      const step = Math.min( 100, ms );
      now += step;
      t.advancePhase( game );
      ms -= step;
    }
  };

  advance( 6999 );
  assert.equal( game.phase, 'scatter' );
  assert.equal( game.phaseTimeMs, 6999 );

  advance( 1 );
  assert.equal( game.phase, 'chase' );
  assert.equal( game.phaseTimeMs, 0 );

  advance( 19999 );
  assert.equal( game.phase, 'chase' );
  assert.equal( game.phaseTimeMs, 19999 );

  advance( 1 );
  assert.equal( game.phase, 'scatter' );
  assert.equal( game.phaseTimeMs, 0 );
} );

test( 'advancePhase limita cada delta a 100 ms', () => {
  let now = 0;
  const t = loadGame( () => now );
  const game = t.createGame();
  game.lastTickMs = 0;

  now = 50000;
  t.advancePhase( game );
  assert.equal( game.phaseTimeMs, 100 );
  assert.equal( game.phase, 'scatter' );
} );

test( 'resetPositions reinicia el ciclo de fases al perder una vida', () => {
  let now = 1234;
  const t = loadGame( () => now );
  const game = t.createGame();
  game.phase = 'chase';
  game.phaseTimeMs = 5000;
  game.lastTickMs = 0;

  t.resetPositions( game );
  assert.equal( game.phase, 'scatter' );
  assert.equal( game.phaseTimeMs, 0 );
  assert.equal( game.lastTickMs, 1234 );
} );

test( 'tres colisiones terminan la partida en estado lost', () => {
  let now = 0;
  const t = loadGame( () => now );
  const game = t.createGame();
  game.state = 'playing';
  game.dotsRemaining = 1000;

  // Encierra a Pac-Man y a un fantasma en la misma celda para forzar choque.
  const sealCollision = () => {
    game.grid[ 0 ][ 1 ] = 1;
    game.grid[ 1 ][ 0 ] = 1;
    game.grid[ 1 ][ 1 ] = 0;
    game.grid[ 1 ][ 2 ] = 1;
    game.grid[ 2 ][ 1 ] = 0;
    game.pacman.x = 1;
    game.pacman.y = 1;
    game.pacman.dir = 'left';
    game.pacman.nextDir = null;
    game.ghosts = [ game.ghosts[ 0 ] ];
    game.ghosts[ 0 ].x = 1;
    game.ghosts[ 0 ].y = 1;
    game.ghosts[ 0 ].dir = 'up';
  };

  sealCollision();
  now += 16;
  t.update( game );
  assert.equal( game.lives, 2 );
  assert.equal( game.phase, 'scatter' );
  assert.equal( game.phaseTimeMs, 0 );

  sealCollision();
  now += 16;
  t.update( game );
  assert.equal( game.lives, 1 );

  sealCollision();
  now += 16;
  t.update( game );
  assert.equal( game.lives, 0 );
  assert.equal( game.state, 'lost' );
} );

test( 'comer el ultimo dot deja la partida en estado won', () => {
  let now = 0;
  const t = loadGame( () => now );
  const game = t.createGame();
  game.state = 'playing';
  game.dotsRemaining = 1;
  game.grid[ 1 ][ 1 ] = 2;
  game.pacman.x = 1;
  game.pacman.y = 1;
  game.pacman.dir = 'right';
  game.pacman.nextDir = null;
  game.ghosts.forEach( ( g, i ) => {
    g.x = 26;
    g.y = 1 + i;
  } );

  now += 16;
  t.update( game );
  assert.equal( game.dotsRemaining, 0 );
  assert.equal( game.state, 'won' );
} );

test( 'los fantasmas cruzan el tunel de la fila 14 sin salir del tablero', () => {
  const t = loadGame();
  const game = t.createGame();
  game.phase = 'scatter';
  const ghost = game.ghosts[ 0 ];

  ghost.x = 0;
  ghost.y = 14;
  ghost.dir = 'left';
  t.moveGhost( game, ghost );
  assert.ok( ghost.x > 27 && ghost.x < 28, 'debe reaparecer por la derecha' );
  assert.equal( ghost.y, 14 );

  ghost.x = 27.95;
  ghost.y = 14;
  ghost.dir = 'right';
  t.moveGhost( game, ghost );
  assert.ok( ghost.x >= 0 && ghost.x < 0.2, 'debe reaparecer por la izquierda' );
} );

test( 'los cuatro fantasmas salen de la pen y cambian de fase con el tiempo', () => {
  let now = 0;
  const t = loadGame( () => now );
  const game = t.createGame();
  game.state = 'playing';
  game.lives = 99;
  game.dotsRemaining = 1000;

  // ~3.2 s: los cuatro ya deben estar fuera de la pen.
  for ( let i = 0; i < 200; i++ ) {
    now += 16;
    t.update( game );
  }
  assert.equal( game.phase, 'scatter' );
  for ( const g of game.ghosts ) {
    assert.equal( t.insidePen( g ), false, g.kind + ' sigue en la pen' );
    assert.ok( g.x >= 0 && g.x < 28, g.kind + ' x fuera del tablero' );
    assert.ok( g.y >= 0 && g.y < 31, g.kind + ' y fuera del tablero' );
  }

  // ~7.2 s: ya debe estar en persecucion.
  for ( let i = 0; i < 250; i++ ) {
    now += 16;
    t.update( game );
  }
  assert.equal( game.phase, 'chase' );
} );

test( 'el color de cada fantasma depende de su kind, no del indice', () => {
  const r = loadRender();
  const game = r.createGame();
  for ( const g of game.ghosts ) g.kind = 'blinky';

  const ctx = fakeCtx();
  r.draw( ctx, game, 0 );

  assert.equal(
    ctx.fills.filter( ( c ) => c === r.GHOST_COLORS.blinky ).length,
    4,
    'los cuatro deben pintarse de rojo'
  );
  for ( const kind of [ 'pinky', 'inky', 'clyde' ] ) {
    assert.equal(
      ctx.fills.filter( ( c ) => c === r.GHOST_COLORS[ kind ] ).length,
      0,
      kind + ' no debe aparecer'
    );
  }
} );

test( 'se dibujan cuatro fantasmas con un color distinto por identidad', () => {
  const r = loadRender();
  const game = r.createGame();
  // Orden invertido a proposito.
  game.ghosts = [ game.ghosts[ 3 ], game.ghosts[ 1 ], game.ghosts[ 0 ], game.ghosts[ 2 ] ];

  const ctx = fakeCtx();
  r.draw( ctx, game, 0 );

  for ( const kind of [ 'blinky', 'pinky', 'inky', 'clyde' ] ) {
    assert.equal(
      ctx.fills.filter( ( c ) => c === r.GHOST_COLORS[ kind ] ).length,
      1,
      kind
    );
  }
} );
