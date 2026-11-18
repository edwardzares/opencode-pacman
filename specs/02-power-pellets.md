# SPEC 02 — Power pellets y modo asustado

> **Estado:** Aprobado
> **Depende de:** SPEC 01
> **Fecha:** 2026-11-18
> **Objetivo:** Añadir cuatro power pellets que activan 10 segundos de modo asustado para que Pac-Man pueda comer fantasmas, con huida, cambio de color y regreso de los fantasmas comidos a la pen.

## Por qué existe esta spec

La SPEC 01 dejó explícitamente fuera los power pellets, el modo asustado y comer fantasmas. El juego ya tiene cuatro fantasmas con personalidad y fases `scatter`/`chase`, pero ninguna respuesta del jugador ante la amenaza más allá de esquivarla. Esta spec cierra ese hueco sin introducir niveles ni sistemas nuevos.

## Scope

**In:**

- Cuatro power pellets en las esquinas accesibles: `(1,1)`, `(26,1)`, `(1,29)`, `(26,29)`.
- Nuevo valor de celda `4` en `MAZE`, originado por el carácter `'o'` en `MAZE_STR`.
- Comer un power pellet suma 50 puntos, vacía la celda y activa 10 s de modo asustado.
- Comer otro power pellet con el modo ya activo **suma** 10 s al tiempo restante y mantiene la cadena de puntos.
- Los fantasmas fuera de la pen invierten su dirección al activarse; después huyen eligiendo al azar entre direcciones válidas.
- Fantasmas asustados a `0.05` celdas/frame; ojos a `0.2` celdas/frame.
- Fantasmas comestibles se dibujan azules y parpadean en blanco durante los últimos 2 s.
- Comer un fantasma asustado suma `200`, `400`, `800`, `1600` dentro de una misma activación continua, sin quitar vidas.
- El fantasma comido se convierte en ojos, vuelve a la pen cruzando la puerta, espera allí hasta que acabe el modo y luego sale con su color y velocidad normales.
- El temporizador `scatter`/`chase` se pausa mientras el poder está activo y continúa en el mismo punto al terminar.
- Perder una vida cancela por completo el modo asustado: colores, cadena y estados de los fantasmas.
- Los power pellets se dibujan como círculos grandes que parpadean.
- La victoria sigue dependiendo solo de los dots; los power pellets son opcionales.
- Cambian `src/js/maze.js`, `src/js/game.js`, `src/js/render.js` y `tests/game.test.js`. No cambian `src/index.html` ni `src/js/main.js`.

**Fuera de alcance (para futuras specs):**

- Niveles, duraciones decrecientes del poder, vidas extra o puntajes altos.
- Indicador en el HUD o efectos de sonido.
- BFS/A* para el regreso de los ojos.
- Fantasmas dentro de la pen cambiando a azul.
- Nuevos tipos de fantasma o nuevas personalidades.

## Modelo de datos

`src/js/maze.js` — cuadrícula pristina con un carácter más:

```js
//   '#' pared(1) · '.' dot(2) · 'o' power pellet(4) · ' ' vacío(0) · '-' puerta(3)

function parseTile( ch ) {
  if ( ch === '#' ) return 1;
  if ( ch === '.' ) return 2;
  if ( ch === '-' ) return 3;
  if ( ch === 'o' ) return 4;
  return 0;
}
```

Las cuatro esquinas de `MAZE_STR` pasan de `'.'` a `'o'`. `createGame()` sigue copiando `MAZE`; nunca se muta el original.

`src/js/game.js` — constantes nuevas:

```js
const POWER_DURATION_MS = 10000;   // 10 s fijos
const POWER_BLINK_MS = 2000;       // últimos 2 s parpadeando
const POWER_BLINK_FRAMES = 15;     // medio ciclo visual en render.js
const POWER_SCORE = 50;
const GHOST_SCORE_CHAIN = [ 200, 400, 800, 1600 ];
const FRIGHTENED_SPEED = 0.05;     // 1/20 celda/frame
const EYES_SPEED = 0.2;            // 1/5 celda/frame
const POWER_PEN_TARGET = { x: 13, y: 11 };
```

Estado añadido al objeto de `createGame()`:

```js
{
  // ...
  pelletsRemaining: 4,   // celdas con valor 4
  powerTimeMs: 0,        // milisegundos restantes; 0 = inactivo
  ghostCombo: 0,         // índice de GHOST_SCORE_CHAIN
}
```

`g.mode` se amplía de `'pen' | 'leaving' | 'normal'` a:

```js
// 'pen' | 'leaving' | 'normal' | 'frightened' | 'eyes'
```

Convenciones:

- `powerTimeMs` es tiempo restante, no acumulado. Al activarse: `game.powerTimeMs += POWER_DURATION_MS`.
- Un fantasma está «fuera de la pen» cuando `!insidePen(g)`; solo esos pasan a `'frightened'`.
- Los ojos usan el objetivo `POWER_PEN_TARGET` y abren la puerta; los fantasmas normales siguen sin poder reentrar.
- Las velocidades `0.05` y `0.2` siguen aterrizando en celdas enteras cada 20 y 5 frames respectivamente.

`src/js/render.js` — colores y dibujo:

```js
const FRIGHTENED_COLOR = '#2121de';
const BLINK_COLOR = '#ffffff';
const POWER_COLOR = '#ffff00';
```

## Plan de implementación

1. **Pellets en el laberinto.** En `src/js/maze.js` añadir el carácter `'o'`, su rama en `parseTile()`, actualizar el comentario de la cabecera y sustituir los cuatro dots de las esquinas. Comprobar con `node --test tests/` que la suite actual sigue pasando y que `MAZE` tiene exactamente cuatro celdas con valor `4`.

2. **Estado y temporizador.** En `src/js/game.js` añadir las constantes y los tres campos nuevos. En `movePacman()`, cuando la celda valga `4`: sumar `POWER_SCORE`, poner la celda a `0`, reducir `pelletsRemaining` y sumar `POWER_DURATION_MS` a `powerTimeMs`. En `update()`, calcular el delta una sola vez por frame, descontarlo de `powerTimeMs` y no avanzar `phaseTimeMs` mientras el poder esté activo; `advancePhase()` pasa a aceptar el delta opcionalmente para no romper las pruebas que lo llaman directamente. Prueba manual: comer un pellet en `(1,1)` suma 50, el cronómetro de fases se congela y se reanuda al acabar los 10 s.

3. **Asustados, puntos y ojos.** En `src/js/game.js` activar el modo al comer: los fantasmas fuera de la pen invierten `g.dir` y pasan a `'frightened'`. En `moveGhost()`, los asustados eligen dirección aleatoria entre las válidas con la misma regla de no invertir 180° salvo callejón sin salida, y se mueven a `FRIGHTENED_SPEED`. En `update()`, si el choque es con un asustado: sumar `GHOST_SCORE_CHAIN[ ghostCombo ]`, aumentar `ghostCombo`, convertirlo en `'eyes'` y no quitar vida; si es con un fantasma normal, aplicar la regla actual de vida perdida. Los ojos apuntan a `POWER_PEN_TARGET`, cruzan la puerta, se mueven a `EYES_SPEED` y pasan a `'pen'` al llegar, donde esperan hasta que `powerTimeMs` llegue a cero. Al terminar el poder, los asustados vuelven a `'normal'`; los ojos que aún viajan terminan su camino. `resetPositions()` pone `powerTimeMs` y `ghostCombo` a cero y restaura todos los modos y velocidades.

4. **Dibujo.** En `src/js/render.js`, dibujar las celdas `4` como círculos de radio ~6 px alternando `POWER_COLOR` y `BLINK_COLOR` según `Math.floor( frame / POWER_BLINK_FRAMES ) % 2`. Elegir el color del fantasma: azul si `mode === 'frightened'`, blanco si además quedan ≤ 2000 ms, `GHOST_COLORS[ g.kind ]` en cualquier otro caso. Para `mode === 'eyes'` dibujar solo los ojos, sin cuerpo. Prueba manual: al activarse el poder los cuatro fantasmas libres se ponen azules, parpadean al final y los comidos aparecen como ojos.

5. **Pruebas.** En `tests/game.test.js` exponer las nuevas constantes y añadir casos para: cuatro pellets en `MAZE`, +50 y activación, acumulación de tiempo sin reiniciar cadena, inversión inicial, cadena `200/400/800/1600`, ojos hasta la pen y espera, pausa de fases, cancelación al perder vida y colores azul/blanco en `fakeCtx()`. Ejecutar `node --test tests/`.

## Criterios de aceptación

- [ ] `MAZE` contiene exactamente cuatro celdas con valor `4` en `(1,1)`, `(26,1)`, `(1,29)` y `(26,29)`; la matriz original no se muta.
- [ ] `createGame()` devuelve `pelletsRemaining === 4` y `dotsRemaining` cuenta solo las celdas con valor `2`.
- [ ] Comer un power pellet suma 50 puntos, deja la celda a `0` y activa 10 s de modo asustado.
- [ ] Comer otro power pellet durante el modo suma 10 s al tiempo restante sin reiniciar la cadena.
- [ ] Comer todos los dots muestra `GANASTE` aunque queden power pellets sin comer.
- [ ] Al activarse, todos los fantasmas fuera de la pen invierten su dirección inmediatamente.
- [ ] Durante el modo, los asustados eligen dirección al azar entre las válidas y solo giran 180° en un callejón sin salida.
- [ ] Los asustados se mueven a `0.05` celdas/frame y los ojos a `0.2`.
- [ ] Los fantasmas comestibles se dibujan azules y parpadean en blanco cuando quedan 2 s o menos.
- [ ] Los power pellets se dibujan como círculos grandes que alternan color según el frame.
- [ ] Chocar con un asustado suma 200, luego 400, 800 y 1600, sin descontar vidas.
- [ ] El fantasma comido se convierte en ojos, cruza la puerta, llega a la pen y espera allí hasta que acabe el modo.
- [ ] Al terminar el modo, los fantasmas recuperan su color por `kind` y los ojos en la pen salen por la puerta con velocidad `0.1`.
- [ ] El temporizador `scatter`/`chase` no avanza mientras el modo está activo y continúa desde el mismo valor al terminar.
- [ ] Perder una vida durante el modo cancela el poder, reinicia la cadena y devuelve todos los fantasmas a la pen.
- [ ] `node --test tests/` pasa sin errores.
- [ ] Al abrir `src/index.html` no hay errores en consola, `Start` oculta el overlay y las flechas mueven a Pac-Man.

## Decisiones tomadas y descartadas

- **Sí:** 10 s fijos. No hay niveles en el proyecto, así que la progresión del arcade no tendría dónde aplicarse.
- **No:** duraciones decrecientes por nivel. Requiere un sistema de niveles ajeno a esta spec.
- **Sí:** acumular tiempo al comer otro pellet. Fue la decisión explícita; el modo se trata como un periodo continuo.
- **Sí:** mantener la cadena de puntos entre pellets. El periodo es continuo, así que el siguiente fantasma vale el siguiente importe.
- **No:** reiniciar la cadena con cada pellet. Contradice la acumulación de tiempo elegida.
- **Sí:** valor `4` con carácter `'o'` en `MAZE_STR`. Una sola fuente de verdad, como el resto del laberinto.
- **No:** arreglo paralelo de coordenadas. Obligaría a sincronizar dos estructuras.
- **No:** contar los pellets como dots. La condición de victoria queda intacta y los pellets siguen siendo opcionales.
- **Sí:** cadena `200/400/800/1600` y pellet de 50. Es la puntuación tradicional del arcade.
- **Sí:** reversión de 180° al activarse y huida aleatoria después. El giro inicial es clásico; después se mantiene la regla de la SPEC 01 de no invertir salvo en callejón sin salida.
- **Sí:** `0.05` para asustados y `0.2` para ojos. Diferencia visible y ambos valores alinean a celdas enteras.
- **No:** `0.075`. Más fiel al arcade, pero casi imperceptible en esta escala.
- **Sí:** parpadeo en los últimos 2 s con azul `#2121de` y blanco `#ffffff`. Azul distinto del borde para no confundirlo con la pared.
- **Sí:** solo cambian a azul los fantasmas comestibles. Los que están en la pen y los ojos conservan su aspecto.
- **Sí:** ojos con decisión codiciosa y puerta forzada. Reutiliza la lógica existente y evita introducir BFS.
- **Sí:** cancelar todo al perder una vida. Evita estados híbridos al reposicionar.
- **No:** HUD, sonido, niveles, vidas extra o puntajes altos. Ya estaban fuera de la SPEC 01.

## Riesgos

| Riesgo | Mitigación |
| --- | --- |
| La decisión codiciosa puede atascar a los ojos ante paredes cóncavas camino a `(13,11)`. | El objetivo está sobre la puerta y la puerta se abre para los ojos; cubrir el recorrido real con una prueba. Si se atasca, BFS va en otra spec. |
| Al pausar las fases, un delta acumulado podría saltar al reanudarse. | `lastTickMs` se actualiza cada frame aunque el poder esté activo; solo se congela `phaseTimeMs`. |
| Acumular pellets puede alargar el modo hasta 40 s. | Es la decisión elegida y hay como máximo cuatro pellets por partida; no se añade un límite no pedido. |
| `fakeCtx()` cuenta los `fill()` del render; dibujar pellets cambia esos recuentos. | Ajustar las pruebas de color existentes para filtrar por color, no por número total de rellenos. |

## Lo que **no** está en esta spec

- Niveles ni duraciones decrecientes del poder.
- Indicador de modo en el HUD o sonidos.
- Búsqueda de camino real (BFS/A*).
- Fantasmas dentro de la pen cambiando de color.
- Vidas extra, puntajes altos ni nuevas personalidades.

Cada uno de esos puntos, si llega, va en su propia spec.
