# SPEC 01 — Cuatro fantasmas con personalidad propia

> **Estado:** Aprobado
> **Depende de:** —
> **Fecha:** 2026-11-12
> **Objetivo:** Reemplazar los dos fantasmas actuales por cuatro con comportamiento distinto (perseguidor, emboscador, flanqueador y tímido) que alternan fases de dispersión y persecución.

## Por qué existe esta spec

Hoy `src/js/game.js` solo reconoce dos clases de fantasma: `hunter` (persigue con distancia Manhattan) y cualquier otro (aleatorio). `src/js/render.js` ya define cuatro colores, pero solo se dibujan dos fantasmas. El juego se siente plano porque no hay amenazas con identidad propia.

Esta spec da a cada fantasma una regla de decisión distinta y un ritmo compartido de fases. También fija la nomenclatura (`blinky`, `pinky`, `inky`, `clyde`) para que el código y el render hablen el mismo idioma.

## Scope

**In:**

- Cuatro fantasmas con `kind` fijo y color propio: `blinky` (rojo), `pinky` (rosa), `inky` (cian) y `clyde` (naranja).
- Los cuatro empiezan dentro de la pen y salen por la puerta como hoy.
- Cuatro reglas de persecución distintas:
  - `blinky` persigue la celda actual de Pac-Man.
  - `pinky` apunta 4 celdas delante de Pac-Man según su dirección.
  - `inky` flanquea usando como referencia la posición de `blinky` y 2 celdas delante de Pac-Man.
  - `clyde` persigue si está a más de 8 celdas de Pac-Man y se retira a su esquina si está más cerca.
- Fases alternadas `scatter` / `chase`: 7 s de dispersión y 20 s de persecución, en bucle.
- En `scatter` cada fantasma se dirige a su propia esquina del laberinto.
- La fase y su temporizador se reinician al perder una vida.
- Colores asignados por `kind` en `src/js/render.js`, no por índice del arreglo.

**Fuera de alcance (para futuras specs):**

- Power pellets y modo asustado (fantasmas azules comestibles).
- Rutas con búsqueda de camino real (BFS/A*) en lugar de decisión codiciosa.
- Indicador visual o sonoro del modo activo en el HUD.
- Cambio de fase progresivo como el original (ciclos con duraciones decrecientes).
- Fantasmas que revierten 180° al cambiar de fase.
- Nuevos niveles, puntajes o vidas extra.

## Modelo de datos

`src/js/maze.js` — cuatro puntos de partida con identidad fija:

```js
const GHOST_STARTS = [
  { x: 13, y: 14, kind: 'blinky' }, // rojo, centro de la pen
  { x: 14, y: 14, kind: 'pinky' },  // rosa, centro de la pen
  { x: 12, y: 13, kind: 'inky' },   // cian, fila superior de la pen
  { x: 15, y: 13, kind: 'clyde' },  // naranja, fila superior de la pen
];
```

`src/js/game.js` — constantes nuevas junto a `GHOST_SPEED`:

```js
const SCATTER_MS = 7000;          // 7 s de dispersión
const CHASE_MS = 20000;           // 20 s de persecución
const PINKY_LEAD = 4;             // celdas de anticipación de pinky
const INKY_LEAD = 2;              // celdas de anticipación de inky
const CLYDE_PANIC_DISTANCE = 8;   // distancia a la que clyde se retira

const GHOST_CORNERS = {
  blinky: { x: 26, y: 1 },  // arriba-derecha
  pinky:  { x: 1,  y: 1 },  // arriba-izquierda
  inky:   { x: 26, y: 29 }, // abajo-derecha
  clyde:  { x: 1,  y: 29 }, // abajo-izquierda
};
```

`src/js/game.js` — estado añadido al objeto que devuelve `createGame()`:

```js
{
  // ...
  phase: 'scatter',             // 'scatter' | 'chase'
  phaseTimeMs: 0,               // tiempo acumulado en la fase actual
  lastTickMs: performance.now(),
  ghosts: GHOST_STARTS.map(/* { x, y, dir, speed, kind } */),
}
```

`src/js/render.js` — color por identidad:

```js
const GHOST_COLORS = {
  blinky: '#ff0000',
  pinky: '#ffb8ff',
  inky: '#00ffff',
  clyde: '#ffb852',
};
```

Convenciones:

- Coordenadas de objetivo: celda `{ x, y }`, origen arriba-izquierda, `x` en `[0, 27]`, `y` en `[0, 30]`.
- Un objetivo puede caer dentro de una pared o fuera de la rejilla: solo se usa para comparar distancias Manhattan desde las celdas vecinas transitables.
- Tiempo de fase en milisegundos con `performance.now()`; no se cuenta por frames.
- Las cuatro velocidades siguen siendo `0.1` celda/frame (`GHOST_SPEED`).

## Plan de implementación

1. **Identidades y colores.** En `src/js/maze.js` reemplazar `GHOST_STARTS` por las cuatro entradas del modelo de datos. En `src/js/game.js` cambiar la comparación de `decideGhost()` de `kind === 'hunter'` a `kind === 'blinky'` para conservar la persecución directa del rojo. En `src/js/render.js` convertir `GHOST_COLORS` en el objeto por `kind` y pintar con `GHOST_COLORS[ g.kind ]`.
   - Prueba manual: al abrir `src/index.html` se ven cuatro fantasmas con los colores rojo, rosa, cian y naranja; el rojo persigue y los otros tres se mueven al azar.

2. **Reglas de persecución.** En `src/js/game.js` añadir `targetFor( game, g )` que devuelva el objetivo según `g.kind`:
   - `blinky`: celda redondeada de Pac-Man.
   - `pinky`: esa misma celda más `PINKY_LEAD` en la dirección actual de Pac-Man.
   - `inky`: `2 * (celda de Pac-Man + INKY_LEAD en su dirección) - posición de blinky`; si no hay `blinky`, usar la celda de Pac-Man.
   - `clyde`: celda de Pac-Man si la distancia Manhattan a él es mayor que `CLYDE_PANIC_DISTANCE`; en caso contrario, `GHOST_CORNERS.clyde`.
   Mantener la selección codiciosa actual: entre las direcciones válidas (sin la opuesta, salvo callejón sin salida), elegir la que minimice la distancia Manhattan entre la celda vecina y el objetivo.
   - Prueba manual: jugar unos segundos y verificar que el rojo cierra distancia, el rosa corta la trayectoria de Pac-Man, el cian aparece por el lado opuesto al rojo y el naranja se aleja cuando Pac-Man se le acerca.

3. **Fases y temporizador.** En `src/js/game.js` añadir `advancePhase( game )`, llamado al inicio de `update()`: leer `performance.now()`, calcular el delta con `game.lastTickMs`, limitarlo a 100 ms, sumarlo a `game.phaseTimeMs` y cambiar de `scatter` a `chase` tras `SCATTER_MS` y de `chase` a `scatter` tras `CHASE_MS`, reiniciando el acumulador. Hacer que `targetFor()` devuelva `GHOST_CORNERS[ g.kind ]` mientras `game.phase === 'scatter'`, para todos los `kind` incluido `clyde`.
   - Prueba manual: al empezar, los cuatro se separan hacia las esquinas; a los ~7 s convergen hacia Pac-Man; a los ~27 s vuelven a dispersarse.

4. **Reinicio al perder vida.** En `resetPositions( game )` reiniciar `phase` a `'scatter'`, `phaseTimeMs` a `0` y `lastTickMs` a `performance.now()` junto con las posiciones.
   - Prueba manual: dejar que un fantasma toque a Pac-Man; las vidas bajan, todos reaparecen en la pen y el ciclo vuelve a empezar en dispersión.

## Criterios de aceptación

- [ ] `GHOST_STARTS` contiene exactamente cuatro entradas y el juego dibuja cuatro fantasmas a la vez.
- [ ] Los colores son rojo para `blinky`, rosa para `pinky`, cian para `inky` y naranja para `clyde`, independientemente del orden del arreglo.
- [ ] El fantasma rojo elige en cada cruce la dirección que más acerque a la celda actual de Pac-Man.
- [ ] El fantasma rosa apunta a una celda situada 4 posiciones delante de Pac-Man en su dirección de avance.
- [ ] El fantasma cian cambia su objetivo cuando cambia la posición del fantasma rojo.
- [ ] El fantasma naranja persigue cuando está a más de 8 celdas de Pac-Man y se dirige a su esquina inferior izquierda cuando está a 8 o menos.
- [ ] Durante los primeros 7 segundos los cuatro fantasmas se dirigen a esquinas distintas.
- [ ] A partir del segundo 7 y hasta el 27 los cuatro cambian a persecución, y a partir del segundo 27 vuelven a dispersión.
- [ ] Perder una vida reinicia el ciclo en fase de dispersión.
- [ ] Ningún fantasma invierte 180° al cambiar de fase; solo lo hace en un callejón sin salida.
- [ ] Los cuatro fantasmas atraviesan el túnel de la fila 14 sin desaparecer ni salirse del canvas.
- [ ] Perder las tres vidas muestra `PERDISTE` y el botón `Reiniciar` vuelve a crear la partida con cuatro fantasmas.
- [ ] Comer todos los dots muestra `GANASTE`.
- [ ] La consola del navegador no muestra errores al cargar ni durante la partida.

## Decisiones tomadas y descartadas

- **Sí:** las cuatro personalidades clásicas (`blinky`, `pinky`, `inky`, `clyde`). Dan diferencias observables sin añadir estados nuevos al jugador.
- **No:** cuatro perseguidores idénticos. Repetir la misma regla no aporta variedad.
- **No:** solo el rojo persigue y el resto vaga. Era el mínimo pedido, pero deja tres fantasmas intercambiables.
- **Sí:** misma velocidad (`0.1`) para los cuatro. La agresividad del rojo se expresa en sus decisiones, no en ventaja de velocidad; así el jugador puede leer el patrón.
- **No:** rojo más rápido. Se descartó por sentirse injusto.
- **Sí:** decisión codiciosa con distancia Manhattan. Es la que ya usa el proyecto, no necesita estado nuevo y es suficiente para cuatro comportamientos.
- **No:** BFS o A* al objetivo. Mejor camino real, pero más código y otra spec si se necesita.
- **Sí:** fases fijas de 7 s de dispersión y 20 s de persecución en bucle. Fáciles de verificar manualmente.
- **No:** calendario progresivo del original (duraciones decrecientes). Añade un contador de ciclos sin cambiar la experiencia de esta spec.
- **Sí:** cada fantasma tiene su propia esquina de dispersión. Separa a los cuatro y produce el abanico clásico.
- **No:** una esquina común para todos. Los agrupa y libera zonas del laberinto.
- **Sí:** se mantiene la regla de no revertir 180°, incluso al cambiar de fase. El movimiento sigue siendo predecible.
- **No:** reversión al cambiar de fase. Se descartó para no introducir una excepción a la regla actual.
- **Sí:** temporizador en milisegundos con `performance.now()` y delta limitado a 100 ms. Es independiente de la tasa de refresco, a diferencia de contar frames.
- **No:** contar frames. A 120 Hz las fases durarían la mitad.
- **Sí:** los cuatro empiezan dentro de la pen. Mantiene el arranque actual y obliga a salir por la puerta.
- **Sí:** reiniciar el ciclo de fases al perder una vida. Da respiro y es el comportamiento clásico.
- **No:** indicador de fase en el HUD. Se deja para otra spec.

## Riesgos

| Riesgo | Mitigación |
| --- | --- |
| La decisión codiciosa puede hacer que `pinky` o `inky` oscilen en paredes cóncavas, porque su objetivo puede caer dentro de una pared. | El objetivo solo desempata direcciones; la regla de callejón sin salida evita quedarse trabado. Si el movimiento se siente errático, una spec futura sustituye la heurística por BFS. |
| Cuatro fantasmas apiñados en la pen pueden superponerse visualmente al arrancar. | Las posiciones de `GHOST_STARTS` están repartidas en dos filas y la puerta permite salir en cuanto se alinean con las columnas 13–14. |
| El temporizador depende de que la pestaña esté activa; al ocultarla, `requestAnimationFrame` se ralentiza y las fases avanzan más lento. | El delta se limita a 100 ms para evitar saltos bruscos al volver. La duración exacta no es un requisito crítico. |
| `inky` necesita la posición de `blinky`. | Si `blinky` no existe en `game.ghosts`, `targetFor()` usa la celda de Pac-Man como referencia. |

## Lo que **no** está en esta spec

- Power pellets, modo asustado y comer fantasmas.
- Búsqueda de camino real (BFS/A*).
- Indicador de fase en el HUD o efectos de sonido.
- Calendario de fases progresivo del arcade original.
- Reversión de dirección al cambiar de fase.
- Niveles, puntajes altos o vidas extra.

Cada uno de esos puntos, si llega, va en su propia spec.
