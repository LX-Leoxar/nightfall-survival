# Nightfall Survival — 3D

Survival multiplayer: di giorno raccogli legno/pietra/fibra/bacche e costruisci, di notte sopravvivi ai
mostri. Riscrittura in 3D vero (Three.js) del prototipo originale, con più stanze, progressione tra le
notti, fame/sete, classifica, riconnessione automatica e controlli touch per mobile.

## Struttura del progetto

```
server.js              server autoritativo multi-stanza (Node + Express + Socket.io)
package.json
data/                   (creata automaticamente) salvataggi locali di mondo e classifica
public/
  index.html             HTML/CSS del gioco (nessun framework)
  js/game.bundle.js       bundle client già compilato (three.js + tutta la logica) — gira in produzione
src/client/                sorgenti leggibili del client, in moduli ES (compilati nel bundle sopra)
  net.js                    socket.io, stanze, riconnessione, interpolazione delle entità remote
  world.js                   scena three.js, cielo, nebbia, meteo (pioggia/nebbia), luce giorno/notte
  entities.js                  mesh 3D: risorse (incl. cespugli di bacche), mostri per tipo, giocatori
                                (con elmo/scudo/zaino), strutture (incl. fossa), proiettili
  player.js                     controller in prima persona: WASD/mouse su desktop, joystick+touch su mobile
  ui.js                          HUD (vita/fame/sete), menu crafting/costruzione, classifica, minimappa
  audio.js                        effetti sonori sintetizzati (nessun file audio esterno)
  main.js                          punto di ingresso, collega tutto e fa girare il loop
```

## Avvio locale

```
npm install
npm start
```

Apri `http://localhost:3000`. Non serve alcun build al primo avvio: `public/js/game.bundle.js` è già
compilato e incluso.

## Deploy su Render (piano gratuito)

- **Build command**: `npm install`
- **Start command**: `npm start`

Non serve altro: il bundle del client è già pronto, `three` ed `esbuild` sono `devDependencies` usate
solo per generarlo in locale, non servono a runtime.

**Persistenza e piano gratuito — nota importante**: il server salva periodicamente mondo e classifica su
file (`data/rooms.json`, `data/leaderboard.json`) e li ricarica all'avvio. Sul piano gratuito di Render
però il filesystem è **effimero**: viene azzerato ad ogni redeploy *e* ad ogni volta che l'istanza si
riavvia (anche solo per lo spin-down/risveglio dopo inattività). In pratica su Render free questo
salvataggio protegge lo stato solo finché l'istanza resta viva, non oltre — è comunque meglio di niente
(un crash improvviso non cancella tutto), ma per una persistenza vera servirebbe un disco persistente
(add-on a pagamento di Render, puoi puntarcelo con la variabile d'ambiente `DATA_DIR`) o un database
esterno. In locale, o su un piano con disco persistente, funziona esattamente come una partita salvata.

Altre note sul piano gratuito (verificate al momento della consegna): il servizio si addormenta dopo
~15 minuti di inattività e la richiesta successiva lo risveglia in 30-60 secondi; i WebSocket sono
pienamente supportati anche gratis, quindi Socket.io funziona senza fallback particolari; gira su
un'unica istanza condivisa (0.1 CPU, 512MB RAM) — per questo lo stato di gioco vive tutto in memoria in
un solo processo: se in futuro passi a più istanze ti servirà un adapter condiviso (es. Redis) per
Socket.io, cosa che sul free (un'istanza sola) non serve.

## Modificare il client 3D

Il file servito in produzione è `public/js/game.bundle.js`, generato da `src/client/`. Dopo averlo
modificato, ricompila con `npm run build` (richiede `three` ed `esbuild`, presenti con un `npm install`
locale normale) e fai commit anche del nuovo `game.bundle.js`.

## Come giocare in più stanze

Nella schermata iniziale c'è un campo "Stanza" oltre al nome: chi lascia il campo vuoto entra nella
stanza pubblica condivisa; chi digita un nome di stanza (es. "amici123") entra in un mondo separato,
creato al volo se non esiste già, condiviso solo da chi usa lo stesso nome. Ogni stanza ha il proprio
mondo, la propria progressione di notti e la propria classifica.

## Novità di questa versione rispetto alla release 3D precedente

- **Stanze multiple**: niente più un solo mondo condiviso da tutti — vedi sopra.
- **Riconnessione automatica**: se cadi di rete o ricarichi la pagina, il browser ricorda la sessione
  (token salvato in locale) e rientri nello stesso punto, con lo stesso inventario, senza dover
  ripassare dalla schermata iniziale. Il personaggio resta "in pausa" sul server per 90 secondi prima di
  essere considerato definitivamente uscito.
- **Difficoltà crescente**: ogni notte sopravvissuta aumenta leggermente il numero e la forza dei mostri
  (fino a un tetto, per restare giocabile). Ogni 5 notti compare un boss.
- **Tre nuovi tipi di mostro** oltre a quello base: veloce e debole, corazzato e lento (più resistente
  alle frecce), e il boss.
- **Fame e sete**: calano nel tempo; a zero cominciano a togliere vita. Si ripristinano mangiando le
  bacche raccolte dai cespugli (tasto F, o pulsante dedicato su mobile).
- **Nuovi oggetti craftabili**: elmo e scudo (riducono ulteriormente il danno subito, si sommano
  all'armatura), zaino (alza il limite di materiali grezzi trasportabili da 60 a 110).
- **Nuova trappola**: la fossa rallenta i mostri che ci passano sopra (a differenza degli spuntoni, che
  fanno danno diretto).
- **Meteo dinamico**: pioggia e nebbia fitta si alternano al sereno a intervalli casuali, con pioggia
  visibile e nebbia che riduce ulteriormente la visibilità.
- **Classifica**: ad ogni morte viene registrato nome, notti sopravvissute e uccisioni; si consulta con
  il tasto L (o il pulsante trofeo su mobile).
- **Più varietà visiva**: alberi in 3 forme (chioma tonda, conifera stretta, albero morto spoglio), rocce
  in 2 forme, mostri con sagoma/colore diversi per tipo.
- **Controlli touch per mobile**: rilevati automaticamente. Joystick virtuale in basso a sinistra per il
  movimento, trascinamento sullo schermo per guardarsi intorno, pulsanti per raccogliere/mangiare/
  attaccare/crafting/costruzione/classifica. È una prima versione: non avendo potuto testarla su un
  dispositivo reale, è il punto più probabile da dover aggiustare (dimensioni pulsanti, sensibilità dello
  sguardo) dopo una prova sul telefono — le costanti rilevanti sono in cima a `player.js`.

## Cosa NON è stato aggiunto

Solo la musica di sottofondo continua, come richiesto: tutto il resto della lista di idee (vedi la
cronologia della chat) è incluso in questa versione. Restano effetti sonori puntuali sintetizzati, niente
loop musicale.

## Limiti noti

- L'intensità delle luci puntuali (falò/torce/fuoco) e i parametri dei controlli touch sono impostati "a
  occhio" — non avendo potuto testare il rendering in un vero browser, sono i primi punti da ritoccare
  se qualcosa non convince. Le costanti sono tutte in cima ai rispettivi file, ben commentate.
- La classifica e il salvataggio del mondo sono per singola stanza/processo: se giochi su Render free e
  l'istanza si riavvia, come spiegato sopra il progresso salvato va perso a meno di un disco persistente.
- Nessun sistema di account: nomi duplicati nella stessa stanza sono permessi e non vengono distinti.
