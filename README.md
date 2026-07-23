# Nightfall Survival — 3D

Survival multiplayer: di giorno raccogli legno/pietra/fibra e costruisci, di notte sopravvivi ai mostri.
Riscrittura in 3D vero (Three.js) del prototipo originale, con netcode più fluido e alcuni sistemi di gioco
completati/corretti.

## Struttura del progetto

```
server.js              server autoritativo (Node + Express + Socket.io)
package.json
public/
  index.html            HTML/CSS del gioco (nessun framework)
  js/game.bundle.js      bundle client già compilato (three.js + tutta la logica) — è quello che gira in produzione
src/client/               sorgenti leggibili del client, in moduli ES (compilati nel bundle sopra)
  net.js                  socket.io + interpolazione delle entità remote
  world.js                 scena three.js, cielo, nebbia, luce giorno/notte
  entities.js               mesh 3D di alberi/rocce/mostri/giocatori/strutture/proiettili
  player.js                  controller in prima persona (WASD, mouse look, predizione+riconciliazione)
  ui.js                       HUD, menu crafting/costruzione, minimappa
  audio.js                     effetti sonori sintetizzati (nessun file audio esterno)
  main.js                       punto di ingresso, collega tutto e fa girare il loop
```

## Avvio locale

```
npm install
npm start
```

Apri `http://localhost:3000`. Non serve alcun build al primo avvio: `public/js/game.bundle.js` è già
compilato e incluso.

## Deploy su Render (piano gratuito)

Il progetto è pensato per restare compatibile con un deploy "as-is" identico a quello che avevi già:

- **Build command**: `npm install`
- **Start command**: `npm start`

Non serve altro — il bundle del client è già pronto in `public/js/`, quindi Render non deve compilare
nulla lato 3D. `three` ed `esbuild` sono `devDependencies` usati solo per generare quel bundle in locale,
non servono a runtime.

Note utili sul piano gratuito di Render (verificate al momento della consegna):
- Il servizio si "addormenta" dopo ~15 minuti di inattività; la richiesta successiva lo risveglia in
  30-60 secondi circa. Il primo giocatore di ogni sessione potrebbe quindi trovare una pagina bianca per
  qualche secondo prima che il server risponda — è normale.
- I WebSocket sono pienamente supportati (anche sul piano free), quindi Socket.io funziona senza
  bisogno di fallback particolari.
- Il piano gratuito gira su una singola istanza condivisa (0.1 CPU, 512MB RAM): per questo il server
  ora manda molti meno dati per tick rispetto a prima (vedi sotto), invece di ottimizzare il calcolo in sé,
  che con questi numeri di giocatori/mostri resta comunque leggero.
- Se in futuro passi a un piano con più istanze, tieni presente che lo stato della partita oggi vive
  tutto in memoria in un solo processo Node: con più istanze servirebbe un adapter condiviso (es. Redis)
  per Socket.io. Sul piano free, con una sola istanza, non è un problema.

## Modificare il client 3D

Il file servito in produzione è `public/js/game.bundle.js`, generato da `src/client/`. Se lo modifichi,
ricompila con:

```
npm run build
```

(richiede che `three` ed `esbuild` siano installati — con un `npm install` locale normale ci sono, dato
che sono devDependencies). Poi fai commit anche del nuovo `game.bundle.js`.

## Cosa è cambiato rispetto al prototipo originale

**Reso davvero 3D**: il rendering "pseudo-3D" a sprite in canvas 2D è stato sostituito con una vera scena
Three.js — terreno, cielo/nebbia che transitano fra giorno e notte, luci dinamiche (falò, torce, molotov),
ombre "finte" economiche, mostri con occhi che brillano nel buio, minimappa.

**Più fluido**:
- Il movimento locale ora si aggiorna a piena frequenza di frame (era agganciato a un tick di rete di 20
  volte al secondo, che lo rendeva "a scatti"); l'invio al server resta comunque a ~20/sec per non
  intasare la rete.
- Mostri, altri giocatori e proiettili vengono ora **interpolati** fra due istantanee del server invece di
  scattare da una posizione all'altra ad ogni pacchetto ricevuto.
- Il server non manda più l'intero elenco di risorse e strutture ad ogni tick (prima venivano ritrasmesse
  20 volte al secondo anche se non cambiava nulla): ora viaggiano solo quando cambiano davvero (evento di
  raccolta, costruzione, distruzione). Anche l'inventario di ciascun giocatore non viene più trasmesso a
  tutti gli altri client, solo al proprietario.

**Bug corretti / funzionalità completate** (il codice originale li aveva già "predisposti" ma non
funzionanti):
- Muro/trappola/falò costavano le risorse **due volte** (una volta craftandoli in inventario, una seconda
  volta piazzandoli) e in più non erano raggiungibili dall'interfaccia se non il muro. Ora hanno un
  menu di costruzione dedicato (tasto Q) col costo corretto, pagato una sola volta.
- Le trappole a spuntoni non facevano alcun danno: ora colpiscono i mostri che vi passano vicino.
- Il falò non aveva alcun effetto oltre a bloccare il passaggio: ora cura lentamente chi gli sta vicino.
- La torcia era craftabile ma impossibile da piazzare nel mondo: ora si piazza dal menu di costruzione.
- La molotov era craftabile ma non esisteva alcun modo di usarla: ora si equipaggia e si lancia (tasto
  destro), esplodendo in una zona di fuoco che danneggia i mostri nel tempo.
- I mostri "aggiravano" i muri in modo un po' insensato senza mai romperli, rendendo le costruzioni
  quasi inutili in difesa: ora, se un muro blocca davvero la strada verso il bersaglio, il mostro lo
  attacca finché non lo abbatte.

**Un po' più difficile da barare**: il server ora valida gli spostamenti (rifiuta salti implausibili e
verifica le collisioni) invece di fidarsi ciecamente della posizione mandata dal client, e calcola da sé
la posizione in cui piazzare una struttura invece di fidarsi delle coordinate ricevute.

## Limiti noti / idee per continuare

- Pensato per desktop (pointer lock + tastiera/mouse): niente controlli touch per mobile.
- Nessun suono/musica di sottofondo continuo, solo effetti puntuali sintetizzati via Web Audio.
- L'intensità delle luci puntuali (falò/torce) è impostata "a occhio" — non avendo potuto testare il
  rendering in un vero browser, sono il primo punto da ritoccare se qualcosa ti sembra troppo buio/chiaro
  (le costanti sono all'inizio di `entities.js` e `world.js`, ben commentate).
- Nessuna persistenza fra riavvii del server: mondo e progressi si resettano ad ogni deploy/riavvio,
  proprio come nel prototipo originale.
