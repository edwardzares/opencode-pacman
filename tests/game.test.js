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
      decideGhost, moveGhost, collides, activatePower, endPower, ghostChoices,
      eyesTarget, tickDelta,
      GHOST_STARTS, GHOST_CORNERS, SCATTER_MS, CHASE_MS, GHOST_SPEED, DIRS,
      PINKY_LEAD, INKY_LEAD, CLYDE_PANIC_DISTANCE,
      POWER_DURATION_MS, POWER_BLINK_MS, POWER_BLINK_FRAMES, POWER_SCORE,
      GHOST_SCORE_CHAIN, FRIGHTENED_SPEED, EYES_SPEED, POWER_PEN_TARGET, MAZE
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
  vm.runInContext(
    `window.__r = {
      GHOST_COLORS, draw, createGame, ghostColor,
      FRIGHTENED_COLOR, BLINK_COLOR, POWER_COLOR,
      POWER_BLINK_MS, POWER_BLINK_FRAMES
    };`,
    sandbox
  );
  return sandbox.__r;
}

// Canvas falso que registra los colores usados en cada fill().
function fakeCtx() {
  return {
    fills: [],
    arcs: [],
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
    arc( x, y, r ) {
      this.arcs.push( r );
    },
    fillText() {},
  };
}

const PELLET_CELLS = [ [ 1, 1 ], [ 26, 1 ], [ 1, 29 ], [ 26, 29 ] ];

function clearPellets( game ) {
  for ( const [ x, y ] of PELLET_CELLS ) game.grid[ y ][ x ] = 0;
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

test( 'los cuatro fantasmas salen de la pen sin superponerse', () => {
  let now = 0;
  const t = loadGame( () => now );
  const game = t.createGame();
  game.state = 'playing';
  game.lives = 99;
  game.dotsRemaining = 1000;
  // Pac-Man quieto y lejos para que nadie lo toque durante la salida.
  game.pacman.x = 1;
  game.pacman.y = 29;
  game.pacman.dir = 'left';
  game.pacman.speed = 0;

  let frames = 0;
  while ( frames < 120 && game.ghosts.some( ( g ) => g.mode !== 'normal' ) ) {
    now += 16;
    t.update( game );
    frames++;
    const cells = game.ghosts.map( ( g ) => Math.round( g.x ) + ',' + Math.round( g.y ) );
    assert.equal( new Set( cells ).size, 4, 'frame ' + frames + ': ' + cells.join( ' ' ) );
  }

  for ( const g of game.ghosts ) {
    assert.equal( g.mode, 'normal', g.kind + ' no termino de salir' );
    assert.equal( t.insidePen( g ), false, g.kind + ' sigue en la pen' );
  }
} );

test( 'un fantasma libre no atraviesa la puerta hacia la pen', () => {
  const t = loadGame();
  const game = t.createGame();
  const ghost = game.ghosts[ 0 ];
  ghost.x = 13;
  ghost.y = 11;
  ghost.dir = 'down';
  ghost.mode = 'normal';
  // Objetivo debajo de la puerta: sin el bloqueo, bajaria a la pen.
  game.phase = 'chase';
  game.pacman.x = 13;
  game.pacman.y = 20;
  game.pacman.dir = 'up';

  for ( let i = 0; i < 10; i++ ) t.moveGhost( game, ghost );

  assert.ok( ghost.y <= 11, 'no debe bajar a la fila de la puerta' );
  assert.equal( t.insidePen( ghost ), false );
} );

test( 'resetPositions deja a los fantasmas listos para salir otra vez', () => {
  const t = loadGame();
  const game = t.createGame();
  for ( const g of game.ghosts ) {
    g.mode = 'normal';
    g.x = 5;
    g.y = 5;
  }

  t.resetPositions( game );

  for ( const g of game.ghosts ) {
    assert.equal( g.mode, 'pen', g.kind + ' debe volver a la pen' );
    assert.equal( t.insidePen( g ), true, g.kind + ' debe empezar en la pen' );
  }
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

test( 'MAZE tiene exactamente cuatro pellets en las esquinas y no se muta', () => {
  const t = loadGame();
  const cells = [];
  t.MAZE.forEach( ( row, y ) => {
    row.forEach( ( v, x ) => {
      if ( v === 4 ) cells.push( [ x, y ] );
    } );
  } );

  assert.deepEqual( cells, PELLET_CELLS );

  const game = t.createGame();
  assert.equal( game.grid[ 1 ][ 1 ], 4 );
  game.grid[ 1 ][ 1 ] = 0;
  assert.equal( t.MAZE[ 1 ][ 1 ], 4, 'MAZE debe seguir pristino' );
} );

test( 'createGame cuenta solo dots para ganar y prepara los pellets del modo', () => {
  const t = loadGame();
  const game = t.createGame();
  const count = ( grid, value ) => grid.reduce(
    ( n, row ) => n + row.filter( ( v ) => v === value ).length,
    0
  );

  // La celda de inicio de Pac-Man tenia dot y createGame la deja vacia.
  assert.equal( game.dotsRemaining, count( t.MAZE, 2 ) - 1 );
  assert.equal( game.dotsRemaining, count( game.grid, 2 ) );
  assert.equal( game.pelletsRemaining, 4 );
  assert.equal( game.powerTimeMs, 0 );
  assert.equal( game.ghostCombo, 0 );
} );

test( 'comer un power pellet suma 50, vacia la celda y activa 10 s', () => {
  let now = 0;
  const t = loadGame( () => now );
  const game = t.createGame();
  game.state = 'playing';
  game.dotsRemaining = 1000;
  game.ghosts = [];
  game.pacman.x = 2;
  game.pacman.y = 1;
  game.pacman.dir = 'left';
  game.pacman.nextDir = null;
  game.grid[ 1 ][ 2 ] = 0; // solo queremos medir el pellet, no el dot previo

  for ( let i = 0; i < 10 && game.grid[ 1 ][ 1 ] === 4; i++ ) {
    now += 16;
    t.update( game );
  }

  assert.equal( game.grid[ 1 ][ 1 ], 0 );
  assert.equal( game.score, t.POWER_SCORE );
  assert.equal( game.pelletsRemaining, 3 );
  assert.equal( game.powerTimeMs, t.POWER_DURATION_MS );
} );

test( 'activatePower invierte solo a los fantasmas fuera de la pen', () => {
  const t = loadGame();
  const game = t.createGame();
  const outside = game.ghosts[ 0 ];
  outside.x = 10;
  outside.y = 5;
  outside.dir = 'right';
  outside.mode = 'normal';

  t.activatePower( game );

  assert.equal( outside.mode, 'frightened' );
  assert.equal( outside.dir, 'left' );
  assert.equal( outside.speed, t.FRIGHTENED_SPEED );
  for ( const g of game.ghosts.slice( 1 ) ) {
    assert.equal( g.mode, 'pen', g.kind );
    assert.equal( g.speed, t.GHOST_SPEED, g.kind );
  }
} );

test( 'comer otro pellet suma tiempo y conserva la cadena de puntos', () => {
  let now = 0;
  const t = loadGame( () => now );
  const game = t.createGame();
  game.state = 'playing';
  game.dotsRemaining = 1000;
  game.ghosts = [];
  game.powerTimeMs = 3000;
  game.ghostCombo = 2;
  game.pacman.x = 25.875;
  game.pacman.y = 1;
  game.pacman.dir = 'right';
  game.pacman.nextDir = null;

  // Dos frames sin delta: el primero alinea y el segundo come la celda 4.
  t.update( game );
  t.update( game );

  assert.equal( game.grid[ 1 ][ 26 ], 0 );
  assert.equal( game.score, t.POWER_SCORE );
  assert.equal( game.pelletsRemaining, 3 );
  assert.equal( game.powerTimeMs, 3000 + t.POWER_DURATION_MS );
  assert.equal( game.ghostCombo, 2, 'la cadena no debe reiniciarse' );
} );

test( 'los asustados eligen al azar entre las direcciones validas y van a 0.05', () => {
  const t = loadGame();
  const game = t.createGame();
  const ghost = game.ghosts[ 0 ];
  ghost.x = 6;
  ghost.y = 5;
  ghost.dir = 'right';
  ghost.mode = 'frightened';
  ghost.speed = t.FRIGHTENED_SPEED;

  const choices = t.ghostChoices( game, ghost );
  assert.ok( choices.length > 1 );
  assert.ok( !choices.includes( 'left' ), 'no puede girar 180 sin callejon' );

  const originalRandom = Math.random;
  try {
    const picked = [];
    for ( const value of [ 0, 0.99 ] ) {
      ghost.x = 6;
      ghost.y = 5;
      ghost.dir = 'right';
      Math.random = () => value;
      t.moveGhost( game, ghost );
      picked.push( ghost.dir );
      const d = t.DIRS[ ghost.dir ];
      assert.ok( Math.abs( ghost.x - ( 6 + d.x * t.FRIGHTENED_SPEED ) ) < 1e-9 );
      assert.ok( Math.abs( ghost.y - ( 5 + d.y * t.FRIGHTENED_SPEED ) ) < 1e-9 );
    }
    assert.equal( picked[ 0 ], choices[ 0 ] );
    assert.notEqual( picked[ 0 ], picked[ 1 ], 'Math.random debe elegir otra salida' );
  } finally {
    Math.random = originalRandom;
  }
} );

test( 'comer cuatro asustados suma 200/400/800/1600 sin quitar vidas', () => {
  let now = 0;
  const t = loadGame( () => now );
  const game = t.createGame();
  game.state = 'playing';
  game.dotsRemaining = 1000;
  game.powerTimeMs = 5000;
  game.pacman.x = 20;
  game.pacman.y = 20;
  game.pacman.speed = 0;
  game.grid[ 20 ][ 20 ] = 0;
  game.ghosts.forEach( ( g ) => {
    g.x = 20;
    g.y = 20;
    g.dir = 'right';
    g.mode = 'frightened';
    g.speed = t.FRIGHTENED_SPEED;
  } );

  for ( let i = 0; i < 4; i++ ) {
    now += 16;
    t.update( game );
  }

  assert.equal( game.score, 200 + 400 + 800 + 1600 );
  assert.equal( game.lives, 3 );
  assert.equal( game.ghostCombo, 4 );
  for ( const g of game.ghosts ) {
    assert.equal( g.mode, 'eyes', g.kind );
    assert.equal( g.speed, t.EYES_SPEED, g.kind );
  }
} );

test( 'los ojos esperan dentro de la pen y vuelven a ser fantasmas al terminar', () => {
  let now = 0;
  const t = loadGame( () => now );
  const game = t.createGame();
  game.state = 'playing';
  game.dotsRemaining = 1000;
  game.powerTimeMs = 2000;
  game.pacman.x = 1;
  game.pacman.y = 29;
  game.pacman.speed = 0;
  game.grid[ 29 ][ 1 ] = 0;

  const eyes = game.ghosts[ 0 ]; // blinky: su celda de la pen es (13,14)
  eyes.x = 13;
  eyes.y = 11;
  eyes.dir = 'down';
  eyes.mode = 'eyes';
  eyes.speed = t.EYES_SPEED;
  game.ghosts = [ eyes ];

  // Atraviesa la puerta y sigue hasta el interior; no se queda en la fila 12.
  for ( let i = 0; i < 20 && ( eyes.x !== 13 || eyes.y !== 14 ); i++ ) {
    now += 16;
    t.update( game );
  }
  assert.equal( eyes.x, 13 );
  assert.equal( eyes.y, 14, 'debe esperar dentro de la pen, no en la puerta' );
  assert.equal( eyes.mode, 'eyes' );
  assert.equal( eyes.speed, t.EYES_SPEED );

  for ( let i = 0; i < 3; i++ ) {
    now += 16;
    t.update( game );
  }
  assert.equal( eyes.x, 13 );
  assert.equal( eyes.y, 14, 'no debe moverse mientras haya poder' );
  assert.equal( eyes.mode, 'eyes' );

  for ( let i = 0; i < 30 && game.powerTimeMs > 0; i++ ) {
    now += 100;
    t.update( game );
  }
  assert.equal( game.powerTimeMs, 0 );
  now += 16;
  t.update( game );

  assert.equal( eyes.mode, 'leaving', 'recupera el cuerpo y empieza a salir' );
  assert.equal( eyes.speed, t.GHOST_SPEED );

  for ( let i = 0; i < 60 && eyes.mode === 'leaving'; i++ ) {
    now += 16;
    t.update( game );
  }
  assert.equal( eyes.mode, 'normal' );
  assert.equal( t.insidePen( eyes ), false );
} );

test( 'el poder congela scatter/chase y el reloj sigue desde el mismo punto', () => {
  let now = 0;
  const t = loadGame( () => now );
  const game = t.createGame();
  game.state = 'playing';
  game.dotsRemaining = 1000;
  game.ghosts = [];
  game.pacman.speed = 0;
  game.phaseTimeMs = 5000;
  game.powerTimeMs = 3000;

  for ( let i = 0; i < 10; i++ ) {
    now += 16;
    t.update( game );
  }
  assert.equal( game.phaseTimeMs, 5000 );
  assert.equal( game.powerTimeMs, 3000 - 160 );

  game.powerTimeMs = 50;
  now += 100;
  t.update( game );
  assert.equal( game.powerTimeMs, 0 );
  assert.equal( game.phaseTimeMs, 5000 );

  now += 16;
  t.update( game );
  assert.equal( game.phaseTimeMs, 5016 );
} );

test( 'perder una vida cancela el poder y devuelve todos los fantasmas', () => {
  let now = 0;
  const t = loadGame( () => now );
  const game = t.createGame();
  game.state = 'playing';
  game.dotsRemaining = 1000;
  game.powerTimeMs = 3000;
  game.ghostCombo = 2;
  game.pacman.x = 20;
  game.pacman.y = 20;
  game.pacman.speed = 0;
  game.grid[ 20 ][ 20 ] = 0;

  const killer = game.ghosts[ 0 ];
  killer.x = 20;
  killer.y = 20;
  killer.dir = 'right';
  killer.mode = 'normal';
  killer.speed = 0;
  for ( const g of game.ghosts.slice( 1 ) ) {
    g.x = 1;
    g.y = 1;
    g.mode = 'frightened';
    g.speed = t.FRIGHTENED_SPEED;
  }

  now += 16;
  t.update( game );

  assert.equal( game.lives, 2 );
  assert.equal( game.powerTimeMs, 0 );
  assert.equal( game.ghostCombo, 0 );
  for ( const g of game.ghosts ) {
    assert.equal( g.mode, 'pen', g.kind );
    assert.equal( g.speed, t.GHOST_SPEED, g.kind );
    assert.equal( t.insidePen( g ), true, g.kind );
  }
} );

test( 'ganar solo requiere dots, aunque queden power pellets', () => {
  let now = 0;
  const t = loadGame( () => now );
  const game = t.createGame();
  game.state = 'playing';
  game.dotsRemaining = 1;
  game.ghosts = [];
  game.pacman.x = 2;
  game.pacman.y = 1;
  game.pacman.dir = 'left';
  game.pacman.nextDir = null;

  now += 16;
  t.update( game );

  assert.equal( game.state, 'won' );
  assert.equal( game.score, 10 );
  assert.equal( game.pelletsRemaining, 4 );
} );

test( 'los pellets se dibujan grandes y alternan color con el frame', () => {
  const r = loadRender();
  const game = r.createGame();
  game.ghosts = [];

  const withPellets = fakeCtx();
  r.draw( withPellets, game, 0 );
  assert.equal( withPellets.arcs.filter( ( rad ) => rad === 6 ).length, 4 );

  const yellow = ( ctx ) => ctx.fills.filter( ( c ) => c === r.POWER_COLOR ).length;
  const withYellow = yellow( withPellets );
  clearPellets( game );
  const withoutPellets = fakeCtx();
  r.draw( withoutPellets, game, 0 );
  assert.equal( withYellow - yellow( withoutPellets ), 4 );

  const blinkGame = r.createGame();
  blinkGame.ghosts = [];
  const blinking = fakeCtx();
  r.draw( blinking, blinkGame, r.POWER_BLINK_FRAMES );
  assert.equal(
    blinking.fills.filter( ( c ) => c === r.BLINK_COLOR ).length,
    4
  );
} );

test( 'los asustados son azules y parpadean blanco en los ultimos 2 s', () => {
  const r = loadRender();
  const game = r.createGame();
  clearPellets( game );
  game.ghosts.forEach( ( g ) => {
    g.mode = 'frightened';
    g.x = 20;
    g.y = 20;
  } );
  const ghost = game.ghosts[ 0 ];

  game.powerTimeMs = 5000;
  let ctx = fakeCtx();
  r.draw( ctx, game, r.POWER_BLINK_FRAMES );
  assert.equal( r.ghostColor( game, ghost, r.POWER_BLINK_FRAMES ), r.FRIGHTENED_COLOR );
  assert.ok( ctx.fills.includes( r.FRIGHTENED_COLOR ) );
  assert.ok( !ctx.fills.includes( r.BLINK_COLOR ) );

  game.powerTimeMs = r.POWER_BLINK_MS + 1;
  assert.equal( r.ghostColor( game, ghost, r.POWER_BLINK_FRAMES ), r.FRIGHTENED_COLOR );

  game.powerTimeMs = r.POWER_BLINK_MS;
  ctx = fakeCtx();
  r.draw( ctx, game, r.POWER_BLINK_FRAMES );
  assert.equal( r.ghostColor( game, ghost, r.POWER_BLINK_FRAMES ), r.BLINK_COLOR );
  assert.equal( ctx.fills.filter( ( c ) => c === r.BLINK_COLOR ).length, 4 );

  ghost.mode = 'normal';
  assert.equal( r.ghostColor( game, ghost, r.POWER_BLINK_FRAMES ), r.GHOST_COLORS.blinky );
} );

test( 'los ojos se dibujan sin cuerpo', () => {
  const r = loadRender();
  const game = r.createGame();
  clearPellets( game );
  game.ghosts.forEach( ( g ) => {
    g.mode = 'eyes';
    g.x = 20;
    g.y = 20;
  } );

  const ctx = fakeCtx();
  r.draw( ctx, game, 0 );

  // Solo el cuerpo de Pac-Man conserva el radio 9; los fantasmas no lo usan.
  assert.equal( ctx.arcs.filter( ( rad ) => rad === 9 ).length, 1 );
  for ( const kind of [ 'blinky', 'pinky', 'inky', 'clyde' ] ) {
    assert.equal( ctx.fills.filter( ( c ) => c === r.GHOST_COLORS[ kind ] ).length, 0 );
  }
  assert.equal( ctx.fills.filter( ( c ) => c === '#0000bb' ).length, 8 );
} );

test( 'al terminar el poder en mitad de celda, el fantasma se alinea y no sale del tablero', () => {
  let now = 0;
  const t = loadGame( () => now );
  const game = t.createGame();
  game.state = 'playing';
  game.dotsRemaining = 1000;
  game.pacman.x = 1;
  game.pacman.y = 29;
  game.pacman.speed = 0;
  game.grid[ 29 ][ 1 ] = 0;

  const ghost = {
    x: 6.25,
    y: 5,
    dir: 'right',
    mode: 'frightened',
    speed: t.FRIGHTENED_SPEED,
    kind: 'blinky',
    exitCol: 13,
    penDelay: 0,
  };
  game.ghosts = [ ghost ];
  game.powerTimeMs = 50; // el siguiente frame agota el poder

  now += 100;
  t.update( game );

  assert.equal( ghost.speed, t.GHOST_SPEED );
  const alignedTo = ( v, step ) => Math.abs( v / step - Math.round( v / step ) ) < 1e-3;
  assert.ok( alignedTo( ghost.x, t.GHOST_SPEED ), 'x debe quedar multiple de 0.1' );
  assert.ok( alignedTo( ghost.y, t.GHOST_SPEED ), 'y debe quedar multiple de 0.1' );

  let turned = false;
  for ( let i = 0; i < 400; i++ ) {
    now += 16;
    t.update( game );
    if ( ghost.dir !== 'right' ) turned = true;
    assert.ok( ghost.x >= 0 && ghost.x < 28, 'x fuera del tablero: ' + ghost.x );
    assert.ok( ghost.y >= 0 && ghost.y < 31, 'y fuera del tablero: ' + ghost.y );
  }
  assert.equal( turned, true, 'debe volver a decidir direccion en una celda' );
} );

test( 'comer un asustado en mitad de celda alinea los ojos y llegan a la pen', () => {
  let now = 0;
  const t = loadGame( () => now );
  const game = t.createGame();
  game.state = 'playing';
  game.dotsRemaining = 1000;
  game.powerTimeMs = 5000;
  game.pacman.x = 20;
  game.pacman.y = 20;
  game.pacman.speed = 0;
  game.grid[ 20 ][ 20 ] = 0;

  const ghost = {
    x: 20.25,
    y: 20,
    dir: 'right',
    mode: 'frightened',
    speed: t.FRIGHTENED_SPEED,
    kind: 'blinky',
    exitCol: 13,
    penDelay: 0,
  };
  game.ghosts = [ ghost ];

  now += 16;
  t.update( game );

  assert.equal( ghost.mode, 'eyes' );
  assert.equal( ghost.speed, t.EYES_SPEED );
  assert.ok( Number.isInteger( ghost.x ), 'x debe alinearse al pasar a 0.2' );
  assert.ok( Number.isInteger( ghost.y ), 'y debe alinearse al pasar a 0.2' );

  game.powerTimeMs = 100000;
  for ( let i = 0; i < 300 && !t.insidePen( ghost ); i++ ) {
    now += 16;
    t.update( game );
    assert.ok( ghost.x >= 0 && ghost.x < 28, 'ojos fuera del tablero' );
    assert.ok( ghost.y >= 0 && ghost.y < 31, 'ojos fuera del tablero' );
  }
  assert.equal( t.insidePen( ghost ), true, 'los ojos deben llegar a la pen' );
} );

test( 'cada ojos espera en su celda interior sin apilarse en la puerta', () => {
  let now = 0;
  const t = loadGame( () => now );
  const game = t.createGame();
  game.state = 'playing';
  game.dotsRemaining = 1000;
  game.powerTimeMs = 100000;
  game.pacman.x = 1;
  game.pacman.y = 29;
  game.pacman.speed = 0;
  game.grid[ 29 ][ 1 ] = 0;

  game.ghosts.forEach( ( g ) => {
    g.x = 13;
    g.y = 11;
    g.dir = 'down';
    g.mode = 'eyes';
    g.speed = t.EYES_SPEED;
  } );

  const restOf = ( g ) => t.GHOST_STARTS.find( ( s ) => s.kind === g.kind );
  const atRest = ( g ) => {
    const rest = restOf( g );
    return g.x === rest.x && g.y === rest.y;
  };

  for ( let i = 0; i < 120 && !game.ghosts.every( atRest ); i++ ) {
    now += 16;
    t.update( game );
  }

  assert.ok( game.ghosts.every( atRest ), 'todos deben llegar a su celda' );
  const cells = game.ghosts.map( ( g ) => g.x + ',' + g.y );
  assert.equal( new Set( cells ).size, 4, 'no deben superponerse: ' + cells.join( ' ' ) );
  for ( const g of game.ghosts ) {
    assert.ok( g.y >= 13, g.kind + ' no debe esperar en la puerta' );
    assert.equal( g.mode, 'eyes' );
  }
} );
