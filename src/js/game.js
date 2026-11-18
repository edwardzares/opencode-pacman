// game.js
// Estado y reglas. Depende de globals de maze.js: MAZE, TUNNEL_ROW,
// PACMAN_START, GHOST_STARTS.

const DIRS = {
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
};
const OPPOSITE = { left: 'right', right: 'left', up: 'down', down: 'up' };

const PACMAN_SPEED = 0.125; // 1/8 celda/frame -> alinea cada 8 frames
const GHOST_SPEED = 0.1;    // 1/10 celda/frame

const SCATTER_MS = 7000;      // 7 s de dispersion
const CHASE_MS = 20000;       // 20 s de persecucion
const PINKY_LEAD = 4;         // celdas de anticipacion de pinky
const INKY_LEAD = 2;          // celdas de anticipacion de inky
const CLYDE_PANIC_DISTANCE = 8; // distancia a la que clyde se retira

const POWER_DURATION_MS = 10000;   // 10 s fijos de modo asustado
const POWER_BLINK_MS = 2000;       // ultimos 2 s parpadeando
const POWER_BLINK_FRAMES = 15;     // medio ciclo visual en render.js
const POWER_SCORE = 50;            // puntos por power pellet
const GHOST_SCORE_CHAIN = [ 200, 400, 800, 1600 ];
const FRIGHTENED_SPEED = 0.05;     // 1/20 celda/frame
const EYES_SPEED = 0.2;            // 1/5 celda/frame
const POWER_PEN_TARGET = { x: 13, y: 11 };

// Salida de la pen. Cada fantasma usa una columna de la puerta y los dos que
// empiezan en la fila superior esperan unos frames para no cruzarse con los
// del centro (si no, quedan perfectamente superpuestos y parecen atrapados).
const PEN_EXIT_ROW = 11;      // fila por encima de la puerta
const PEN_EXIT_COL = {
  blinky: 13,
  pinky: 14,
  inky: 13,
  clyde: 14,
};
const PEN_EXIT_DELAY = {      // frames de espera dentro de la pen
  blinky: 0,
  pinky: 0,
  inky: 20,
  clyde: 20,
};

const GHOST_CORNERS = {
  blinky: { x: 26, y: 1 },  // arriba-derecha
  pinky:  { x: 1,  y: 1 },  // arriba-izquierda
  inky:   { x: 26, y: 29 }, // abajo-derecha
  clyde:  { x: 1,  y: 29 }, // abajo-izquierda
};

// Crea una partida nueva. Copia MAZE (pristino) a game.grid para poder comer
// dots sin destruir el original, y reiniciar.
function createGame() {
  const grid = MAZE.map( ( row ) => row.slice() );
  // La celda de inicio de Pacman arranca sin dot.
  grid[ PACMAN_START.y ][ PACMAN_START.x ] = 0;

  let dots = 0;
  let pellets = 0;
  for ( const row of grid ) {
    for ( const v of row ) {
      if ( v === 2 ) dots++;
      if ( v === 4 ) pellets++;
    }
  }

  return {
    state: 'start',
    score: 0,
    lives: 3,
    dotsRemaining: dots,
    pelletsRemaining: pellets,
    powerTimeMs: 0,
    ghostCombo: 0,
    grid,
    phase: 'scatter',
    phaseTimeMs: 0,
    lastTickMs: performance.now(),
    pacman: {
      x: PACMAN_START.x,
      y: PACMAN_START.y,
      dir: 'left',
      nextDir: null,
      speed: PACMAN_SPEED,
    },
    ghosts: GHOST_STARTS.map( ( g ) => ( {
      x: g.x,
      y: g.y,
      dir: 'up',
      speed: GHOST_SPEED,
      kind: g.kind,
      mode: 'pen',                       // 'pen' -> 'leaving' -> 'normal'
      exitCol: PEN_EXIT_COL[ g.kind ],
      penDelay: PEN_EXIT_DELAY[ g.kind ],
    } ) ),
  };
}

function aligned( v ) {
  return Math.abs( v - Math.round( v ) ) < 1e-3;
}

// Una celda es muro para el actor dado?
//   pacman: bloqueado por pared (1) y puerta (3)
//   ghost:  bloqueado por pared (1); la puerta (3) solo se abre para quien
//           esta saliendo de la pen (mode 'leaving'), asi no puede reentrar.
function isWall( grid, x, y, actor, doorOpen ) {
  if ( y < 0 || y >= grid.length ) return true;
  if ( x < 0 || x >= grid[ 0 ].length ) return true;
  const v = grid[ y ][ x ];
  if ( v === 1 ) return true;
  if ( v === 3 && ( actor === 'pacman' || !doorOpen ) ) return true;
  return false;
}

// Puede el actor avanzar desde (x,y) en la direccion dir?
function canMove( grid, x, y, dir, actor, doorOpen ) {
  const d = DIRS[ dir ];
  if ( !d ) return false;
  const tx = x + d.x;
  const ty = y + d.y;
  // Tunel: salir por un borde en la fila del tunel siempre es valido.
  if ( ty === TUNNEL_ROW && ( tx < 0 || tx >= grid[ 0 ].length ) ) return true;
  return !isWall( grid, tx, ty, actor, doorOpen );
}

function wrapTunnel( a, width ) {
  if ( Math.round( a.y ) === TUNNEL_ROW ) {
    if ( a.x < 0 ) a.x += width;
    else if ( a.x >= width ) a.x -= width;
  }
}

// Cambiar de velocidad en mitad de celda rompe la alineacion: 0.05 y 0.1
// solo coinciden en celda entera si el desplazamiento acumulado es multiplo
// de la nueva velocidad. Alinear antes de cambiar evita que el fantasma
// siga recto sin volver a decidir direccion y se salga del tablero.
function setGhostSpeed( game, g, speed ) {
  g.x = Math.round( g.x );
  g.y = Math.round( g.y );
  wrapTunnel( g, game.grid[ 0 ].length );
  g.speed = speed;
}

function movePacman( game ) {
  const p = game.pacman;
  const grid = game.grid;
  const width = grid[ 0 ].length;

  if ( aligned( p.x ) && aligned( p.y ) ) {
    p.x = Math.round( p.x );
    p.y = Math.round( p.y );

    // Aplicar giro pendiente si es posible.
    if ( p.nextDir && canMove( grid, p.x, p.y, p.nextDir, 'pacman' ) ) {
      p.dir = p.nextDir;
      p.nextDir = null;
    }
    // Comer dot.
    if ( grid[ p.y ][ p.x ] === 2 ) {
      grid[ p.y ][ p.x ] = 0;
      game.score += 10;
      game.dotsRemaining--;
    }
    // Comer power pellet: acumula tiempo, no reinicia el modo.
    if ( grid[ p.y ][ p.x ] === 4 ) {
      grid[ p.y ][ p.x ] = 0;
      game.score += POWER_SCORE;
      game.pelletsRemaining--;
      game.powerTimeMs += POWER_DURATION_MS;
      activatePower( game );
    }
    // Si no puede seguir, se detiene en la celda.
    if ( !canMove( grid, p.x, p.y, p.dir, 'pacman' ) ) return;
  }

  const d = DIRS[ p.dir ];
  p.x += d.x * p.speed;
  p.y += d.y * p.speed;
  wrapTunnel( p, width );
}

// Invierte la direccion de los fantasmas que estan fuera de la pen y los
// vuelve comestibles. Los que estan dentro siguen su salida normal.
function activatePower( game ) {
  game.ghosts.forEach( ( g ) => {
    if ( g.mode !== 'normal' || insidePen( g ) ) return;
    g.dir = OPPOSITE[ g.dir ];
    g.mode = 'frightened';
    setGhostSpeed( game, g, FRIGHTENED_SPEED );
  } );
}

// Un fantasma esta dentro de la pen (interior x 11-16, y 13-15) o en la
// puerta (y 12). La unica salida es hacia arriba, por la puerta.
function insidePen( g ) {
  const gx = Math.round( g.x );
  const gy = Math.round( g.y );
  return gx >= 11 && gx <= 16 && gy >= 12 && gy <= 15;
}

// Objetivo de persecucion segun la personalidad del fantasma.
// El objetivo puede caer en pared o fuera de la rejilla: solo sirve para
// comparar distancias Manhattan desde las celdas vecinas transitables.
function targetFor( game, g ) {
  const p = game.pacman;
  const px = Math.round( p.x );
  const py = Math.round( p.y );
  const d = DIRS[ p.dir ];

  // Salir de la pen antes de aplicar personalidad o esquina de dispersion.
  // Se apunta por encima de la puerta para no quedarse rebotando en ella.
  if ( insidePen( g ) ) return { x: 13, y: 11 };

  // En dispersion cada fantasma se refugia en su propia esquina.
  if ( game.phase === 'scatter' ) return GHOST_CORNERS[ g.kind ];

  if ( g.kind === 'pinky' ) {
    return { x: px + d.x * PINKY_LEAD, y: py + d.y * PINKY_LEAD };
  }

  if ( g.kind === 'inky' ) {
    const aheadX = px + d.x * INKY_LEAD;
    const aheadY = py + d.y * INKY_LEAD;
    const blinky = game.ghosts.find( ( other ) => other.kind === 'blinky' );
    if ( !blinky ) return { x: px, y: py };
    const bx = Math.round( blinky.x );
    const by = Math.round( blinky.y );
    return { x: 2 * aheadX - bx, y: 2 * aheadY - by };
  }

  if ( g.kind === 'clyde' ) {
    const gx = Math.round( g.x );
    const gy = Math.round( g.y );
    const dist = Math.abs( gx - px ) + Math.abs( gy - py );
    if ( dist > CLYDE_PANIC_DISTANCE ) return { x: px, y: py };
    return GHOST_CORNERS.clyde;
  }

  // blinky: celda actual de Pac-Man.
  return { x: px, y: py };
}

// Celda interior de la pen donde cada fantasma recupera su cuerpo. No es la
// puerta (fila 12): esperar ahi los deja superpuestos en el borde.
function penRest( g ) {
  return GHOST_STARTS.find( ( start ) => start.kind === g.kind ) || GHOST_STARTS[ 0 ];
}

// Objetivos intermedios para los ojos: acercan por los pasillos laterales y
// evitan que la decision codiciosa se quede pegada en las paredes de la pen.
function eyesTarget( g ) {
  if ( g.y >= 14 ) {
    if ( g.x < 14 ) {
      if ( g.y > 14 ) return { x: 6, y: 14 };
      if ( g.x < 9 ) return { x: 9, y: 14 };
      return { x: 9, y: 11 };
    }
    if ( g.y > 14 ) return { x: 21, y: 14 };
    if ( g.x > 18 ) return { x: 18, y: 14 };
    return { x: 18, y: 11 };
  }

  if ( g.y <= 8 ) {
    if ( g.x < 14 ) {
      if ( g.x === 9 ) return g.y < 8 ? { x: 9, y: 8 } : { x: 12, y: 8 };
      if ( g.y === 8 && g.x < 12 ) return { x: 12, y: 8 };
      if ( g.x === 12 && g.y === 8 ) return { x: 12, y: 11 };
      if ( g.x === 12 && g.y === 11 ) return POWER_PEN_TARGET;
      return { x: 9, y: 5 };
    }
    if ( g.x === 18 ) return g.y < 8 ? { x: 18, y: 8 } : { x: 15, y: 8 };
    if ( g.y === 8 && g.x > 15 ) return { x: 15, y: 8 };
    if ( g.x === 15 && g.y === 8 ) return { x: 15, y: 11 };
    if ( g.x === 15 && g.y === 11 ) return POWER_PEN_TARGET;
    return { x: 18, y: 5 };
  }

  if ( g.y === 11 ) return POWER_PEN_TARGET;
  if ( g.x >= 9 && g.x <= 13 ) return { x: 12, y: 11 };
  if ( g.x >= 15 && g.x <= 18 ) return { x: 15, y: 11 };
  return g.x < 14 ? { x: 9, y: 11 } : { x: 18, y: 11 };
}

// Direcciones transitables sin la opuesta; en callejon sin salida se permite
// el giro de 180. Los ojos y quien sale de la pen pueden cruzar la puerta.
function ghostChoices( game, g ) {
  const doorOpen = g.mode === 'leaving' || g.mode === 'eyes';
  const options = Object.keys( DIRS ).filter(
    ( dir ) => dir !== OPPOSITE[ g.dir ] &&
      canMove( game.grid, g.x, g.y, dir, 'ghost', doorOpen )
  );
  return options.length ? options : [ '' + OPPOSITE[ g.dir ] ];
}

// Elige la direccion que mas acerca al objetivo, con distancia Manhattan.
function chooseGhostByTarget( g, choices, target ) {
  let best = choices[ 0 ];
  let bestDist = Infinity;
  for ( const dir of choices ) {
    const d = DIRS[ dir ];
    const dist = Math.abs( g.x + d.x - target.x ) + Math.abs( g.y + d.y - target.y );
    if ( dist < bestDist ) {
      bestDist = dist;
      best = dir;
    }
  }
  g.dir = best;
}

function decideGhost( game, g ) {
  chooseGhostByTarget( g, ghostChoices( game, g ), targetFor( game, g ) );
}

function moveGhost( game, g ) {
  const grid = game.grid;
  const width = grid[ 0 ].length;

  if ( aligned( g.x ) && aligned( g.y ) ) {
    g.x = Math.round( g.x );
    g.y = Math.round( g.y );

    if ( g.mode === 'eyes' ) {
      // Primero al corredor sobre la puerta, luego a su celda dentro de la pen.
      const rest = penRest( g );
      const atRest = g.x === rest.x && g.y === rest.y;
      if ( atRest ) {
        if ( game.powerTimeMs > 0 ) return; // espera aqui, no en la puerta
        g.mode = 'leaving';                 // recupera el cuerpo al acabar
        g.penDelay = 0;
        setGhostSpeed( game, g, GHOST_SPEED );
        return;
      }
      if ( g.y === PEN_EXIT_ROW && Math.round( g.x ) === POWER_PEN_TARGET.x ) {
        g.dir = 'down';
      } else {
        const target = insidePen( g ) ? rest : eyesTarget( g );
        chooseGhostByTarget( g, ghostChoices( game, g ), target );
      }
      if ( !canMove( grid, g.x, g.y, g.dir, 'ghost', true ) ) return;
    } else {
      // Si por algun motivo esta fuera de la pen, la salida ya no aplica.
      if ( g.mode === 'pen' && !insidePen( g ) ) g.mode = 'normal';

      // Espera inicial dentro de la pen para no salir pisando a otro.
      if ( g.mode === 'pen' ) {
        if ( g.penDelay > 0 ) {
          g.penDelay--;
          return;
        }
        g.mode = 'leaving';
      }

      // Al superar la puerta vuelve al comportamiento normal.
      if ( g.mode === 'leaving' && g.y <= PEN_EXIT_ROW ) {
        g.mode = 'normal';
      }

      if ( g.mode === 'leaving' ) {
        // Ruta forzada: primero a la columna de salida, luego hacia arriba.
        if ( g.x < g.exitCol ) g.dir = 'right';
        else if ( g.x > g.exitCol ) g.dir = 'left';
        else g.dir = 'up';
      } else if ( g.mode === 'frightened' ) {
        const choices = ghostChoices( game, g );
        g.dir = choices[ Math.floor( Math.random() * choices.length ) ];
      } else {
        decideGhost( game, g );
      }

      // La puerta solo esta abierta mientras el fantasma esta saliendo.
      if ( !canMove( grid, g.x, g.y, g.dir, 'ghost', g.mode === 'leaving' ) ) return;
    }
  }

  const d = DIRS[ g.dir ];
  g.x += d.x * g.speed;
  g.y += d.y * g.speed;
  wrapTunnel( g, width );
}

// Termina el poder: los comestibles vuelven a su color y personalidad. Los
// ojos que aun viajan llegan a su celda de la pen y alli recuperan el cuerpo.
function endPower( game ) {
  game.ghostCombo = 0;
  game.ghosts.forEach( ( g ) => {
    if ( g.mode === 'frightened' ) {
      g.mode = 'normal';
      setGhostSpeed( game, g, GHOST_SPEED );
    }
  } );
}

function resetPositions( game ) {
  game.phase = 'scatter';
  game.phaseTimeMs = 0;
  game.lastTickMs = performance.now();
  game.powerTimeMs = 0;
  game.ghostCombo = 0;

  const p = game.pacman;
  p.x = PACMAN_START.x;
  p.y = PACMAN_START.y;
  p.dir = 'left';
  p.nextDir = null;
  game.ghosts.forEach( ( g, i ) => {
    g.x = GHOST_STARTS[ i ].x;
    g.y = GHOST_STARTS[ i ].y;
    g.dir = 'up';
    g.mode = 'pen';
    g.speed = GHOST_SPEED;
    g.exitCol = PEN_EXIT_COL[ g.kind ];
    g.penDelay = PEN_EXIT_DELAY[ g.kind ];
  } );
}

function collides( a, b ) {
  return Math.abs( a.x - b.x ) < 0.5 && Math.abs( a.y - b.y ) < 0.5;
}

// Devuelve el delta real desde el ultimo tick, limitado a 100 ms para evitar
// saltos tras ocultar la pestana. lastTickMs se actualiza siempre, incluso
// mientras el poder congela las fases.
function tickDelta( game ) {
  const now = performance.now();
  let delta = now - game.lastTickMs;
  game.lastTickMs = now;
  if ( delta > 100 ) delta = 100;
  return delta;
}

// Avanza el temporizador de fase. update() pasa el delta del frame; las
// pruebas pueden llamarlo sin argumentos y entonces calcula su propio delta.
function advancePhase( game, deltaMs ) {
  const delta = deltaMs === undefined ? tickDelta( game ) : deltaMs;
  game.phaseTimeMs += delta;

  if ( game.phase === 'scatter' && game.phaseTimeMs >= SCATTER_MS ) {
    game.phase = 'chase';
    game.phaseTimeMs = 0;
  } else if ( game.phase === 'chase' && game.phaseTimeMs >= CHASE_MS ) {
    game.phase = 'scatter';
    game.phaseTimeMs = 0;
  }
}

function update( game ) {
  const delta = tickDelta( game );
  if ( game.powerTimeMs > 0 ) {
    game.powerTimeMs = Math.max( 0, game.powerTimeMs - delta );
    if ( game.powerTimeMs === 0 ) endPower( game );
  } else {
    advancePhase( game, delta );
  }
  movePacman( game );
  game.ghosts.forEach( ( g ) => moveGhost( game, g ) );

  for ( const g of game.ghosts ) {
    if ( !collides( game.pacman, g ) ) continue;

    if ( g.mode === 'frightened' ) {
      const index = Math.min( game.ghostCombo, GHOST_SCORE_CHAIN.length - 1 );
      game.score += GHOST_SCORE_CHAIN[ index ];
      game.ghostCombo++;
      g.mode = 'eyes';
      setGhostSpeed( game, g, EYES_SPEED );
      continue;
    }
    if ( g.mode === 'eyes' ) continue;

    game.lives--;
    if ( game.lives <= 0 ) {
      game.state = 'lost';
      return;
    }
    resetPositions( game );
    break;
  }

  if ( game.dotsRemaining <= 0 ) game.state = 'won';
}

window.createGame = createGame;
window.update = update;
window.DIRS = DIRS;
