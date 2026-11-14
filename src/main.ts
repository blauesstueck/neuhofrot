import './style.css';
import { CHARACTERS, type Character } from './characters';
import { board, NEUHOF, START_COINS, FRUIT_PRICE, BLUE_COINS, RED_COINS, LAP_BONUS, MINIGAME_PRIZE } from './board';
import { CityMap } from './map';
import { geocode, generateBoard } from './generate';
import { runMinigame } from './minigames';

interface Player {
  name: string;
  char: Character;
  coins: number;
  fruits: number;
  pos: number;
}

const overlay = document.getElementById('overlay')!;
const hud = document.getElementById('hud')!;
const city = new CityMap('map');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rand = (n: number) => Math.floor(Math.random() * n);
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const panelPadding = () => (window.innerWidth > 900 ? 440 : 0);

// Zum Testen: ?feld=3 startet alle Spieler auf Feld 3 statt am Rathaus.
const DEBUG_START = Math.max(0, +(new URLSearchParams(location.search).get('feld') ?? 0) || 0);

// ---------------------------------------------------------------- Setup

const setup = {
  count: 2,
  names: ['Niklas', 'Morris', 'Spieler 3', 'Spieler 4'],
  chars: [0, 1, 2, 3],
  rounds: 8,
  place: NEUHOF.name,
  /** Ort, für den das Brett gerade gebaut ist */
  built: NEUHOF.name,
};

function renderSetup() {
  overlay.innerHTML = `
    <div class="panel setup">
      <h1 class="logo"><span>Neuhofrot</span> <span>Party</span> 🍍</h1>
      <p class="sub">Das Brainrot-Brettspiel mitten durch deinen Ort</p>

      <h3>1 · Wo wird gespielt?</h3>
      <form id="place-form" class="row">
        <input id="place" type="text" placeholder="PLZ und Ort, z. B. 36119 Neuhof" autocomplete="off" />
        <button class="btn" type="submit">Bauen</button>
      </form>
      <div id="place-status" class="status"></div>

      <h3>2 · Wer spielt mit?</h3>
      <div class="row seg" id="count">
        ${[2, 3, 4].map((n) => `<button type="button" data-n="${n}">${n} Spieler</button>`).join('')}
      </div>
      <div id="players"></div>

      <h3>3 · Wie lange?</h3>
      <div class="row seg" id="rounds">
        ${[5, 8, 12].map((n) => `<button type="button" data-n="${n}">${n} Runden</button>`).join('')}
      </div>

      <button class="btn primary big-btn" id="start">Party starten!</button>
    </div>`;

  const status = overlay.querySelector<HTMLElement>('#place-status')!;
  const placeInput = overlay.querySelector<HTMLInputElement>('#place')!;
  placeInput.value = setup.place;
  const describe = () =>
    board.streets
      ? `✅ ${board.name} – ${board.spaces.length} Felder auf echten Straßen`
      : `⚠️ ${board.name} – kein passendes Straßennetz gefunden, es gibt einen einfachen Rundkurs`;
  status.textContent = describe();

  let building: Promise<boolean> | null = null;
  /** Baut das Brett für den eingegebenen Ort (falls es nicht schon steht). */
  const buildPlace = (): Promise<boolean> => {
    const q = placeInput.value.trim();
    if (!q) {
      status.textContent = 'Bitte erst PLZ und Ort eingeben.';
      return Promise.resolve(false);
    }
    if (q.toLowerCase() === setup.built.toLowerCase()) return Promise.resolve(true);
    building ??= (async () => {
      try {
        await city.ready;
        if (q.toLowerCase() === NEUHOF.name.toLowerCase()) {
          city.setBoard(NEUHOF);
        } else {
          status.textContent = '🔎 Suche Ort…';
          const hit = await geocode(q);
          if (!hit) {
            status.textContent = '❌ Ort nicht gefunden – probier es mit PLZ und Ortsname.';
            return false;
          }
          status.textContent = `🏗️ Baue Spielfeld in ${hit.name}…`;
          city.setBoard(await generateBoard(city.map, hit));
        }
        setup.place = setup.built = q;
        status.textContent = describe();
        city.overview(panelPadding(), 2500);
        return true;
      } catch (err) {
        console.error(err);
        status.textContent = '❌ Ortssuche gerade nicht erreichbar – versuch es gleich nochmal.';
        return false;
      } finally {
        building = null;
      }
    })();
    return building;
  };
  overlay.querySelector('#place-form')!.addEventListener('submit', (e) => {
    e.preventDefault();
    void buildPlace();
  });

  const syncSeg = () => {
    overlay.querySelectorAll<HTMLElement>('#count button').forEach((b) => b.classList.toggle('sel', +b.dataset.n! === setup.count));
    overlay.querySelectorAll<HTMLElement>('#rounds button').forEach((b) => b.classList.toggle('sel', +b.dataset.n! === setup.rounds));
  };
  overlay.querySelector('#count')!.addEventListener('click', (e) => {
    const n = (e.target as HTMLElement).dataset.n;
    if (!n) return;
    setup.count = +n;
    // doppelte Charaktere auflösen
    for (let i = 0; i < setup.count; i++) {
      const taken = setup.chars.slice(0, i);
      if (taken.includes(setup.chars[i])) setup.chars[i] = CHARACTERS.findIndex((_, c) => !taken.includes(c));
    }
    syncSeg();
    renderPlayers();
  });
  overlay.querySelector('#rounds')!.addEventListener('click', (e) => {
    const n = (e.target as HTMLElement).dataset.n;
    if (!n) return;
    setup.rounds = +n;
    syncSeg();
  });

  const playersEl = overlay.querySelector<HTMLElement>('#players')!;
  const renderPlayers = () => {
    playersEl.innerHTML = Array.from({ length: setup.count }, (_, i) => {
      const me = CHARACTERS[setup.chars[i]];
      return `
        <div class="player-pick" style="--c:${me.color}">
          <div class="row">
            <span class="avatar">${me.art}</span>
            <input class="name" data-i="${i}" maxlength="14" value="${esc(setup.names[i])}" />
          </div>
          <div class="chips">
            ${CHARACTERS.map((c, ci) => {
              const taken = setup.chars.slice(0, setup.count).some((x, j) => x === ci && j !== i);
              return `<button type="button" class="chip ${ci === setup.chars[i] ? 'sel' : ''}" data-i="${i}" data-c="${ci}" title="${c.name}" ${taken ? 'disabled' : ''}>${c.art}</button>`;
            }).join('')}
          </div>
          <div class="char-name">${me.name}</div>
        </div>`;
    }).join('');
  };
  playersEl.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.classList.contains('name')) setup.names[+t.dataset.i!] = t.value;
  });
  playersEl.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('.chip');
    if (!t) return;
    setup.chars[+t.dataset.i!] = +t.dataset.c!;
    renderPlayers();
  });

  overlay.querySelector('#start')!.addEventListener('click', async (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    btn.disabled = true;
    const ok = await buildPlace();
    btn.disabled = false;
    if (!ok) return;
    const players: Player[] = Array.from({ length: setup.count }, (_, i) => ({
      name: setup.names[i].trim() || `Spieler ${i + 1}`,
      char: CHARACTERS[setup.chars[i]],
      coins: START_COINS,
      fruits: 0,
      pos: Math.min(board.spaces.length - 1, DEBUG_START),
    }));
    overlay.innerHTML = '';
    void playGame(players, setup.rounds);
  });

  syncSeg();
  renderPlayers();
}

// ---------------------------------------------------------------- Spiel

const DICE = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

async function playGame(players: Player[], rounds: number) {
  let round = 1;
  let current = 0;
  let fruitSpace = 0;

  hud.innerHTML = `
    <div class="hud-players"></div>
    <div class="hud-round"></div>
    <div class="hud-action">
      <div id="msg"></div>
      <div id="dice"></div>
      <div id="branch" class="row center"></div>
      <button class="btn primary" id="roll" hidden>🎲 Würfeln</button>
    </div>`;
  const msgEl = hud.querySelector<HTMLElement>('#msg')!;
  const diceEl = hud.querySelector<HTMLElement>('#dice')!;
  const rollBtn = hud.querySelector<HTMLButtonElement>('#roll')!;

  const renderHud = () => {
    hud.querySelector('.hud-players')!.innerHTML = players
      .map(
        (p, i) => `
        <div class="card ${i === current ? 'active' : ''}" style="--c:${p.char.color}">
          <span class="avatar">${p.char.art}</span>
          <div>
            <div class="card-name">${esc(p.name)}</div>
            <div class="card-stats"><span>🪙 ${p.coins}</span><span>🍍 ${p.fruits}</span></div>
          </div>
        </div>`,
      )
      .join('');
    hud.querySelector('.hud-round')!.textContent = `Runde ${round} / ${rounds}`;
  };
  const say = (html: string) => {
    msgEl.innerHTML = html;
    msgEl.classList.remove('pop');
    void msgEl.offsetWidth;
    msgEl.classList.add('pop');
  };
  const addCoins = (p: Player, n: number) => {
    p.coins = Math.max(0, p.coins + n);
    renderHud();
  };

  const ask = (html: string, buttons: string[]) =>
    new Promise<number>((resolve) => {
      const m = document.createElement('div');
      m.className = 'backdrop';
      m.innerHTML = `<div class="panel modal">${html}<div class="row center">${buttons
        .map((b, i) => `<button class="btn ${i === 0 ? 'primary' : ''}" data-b="${i}">${b}</button>`)
        .join('')}</div></div>`;
      m.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).dataset.b;
        if (b === undefined) return;
        m.remove();
        resolve(+b);
      });
      overlay.append(m);
    });

  const waitRoll = () =>
    new Promise<void>((resolve) => {
      rollBtn.hidden = false;
      const done = () => {
        rollBtn.hidden = true;
        rollBtn.removeEventListener('click', done);
        window.removeEventListener('keydown', onKey);
        resolve();
      };
      const onKey = (e: KeyboardEvent) => {
        if (e.code === 'Space' || e.code === 'Enter') {
          e.preventDefault();
          done();
        }
      };
      rollBtn.addEventListener('click', done);
      window.addEventListener('keydown', onKey);
    });

  const branchEl = hud.querySelector<HTMLElement>('#branch')!;
  /** Abzweigung: Spieler wählt per Knopf, Wegweiser auf der Karte oder Zifferntaste. */
  const chooseBranch = (p: Player) =>
    new Promise<number>((resolve) => {
      const options = board.spaces[p.pos].next;
      say(`🔀 ${esc(p.name)}, wohin soll's gehen?`);
      city.focus(p.pos, 600, 16.2);
      const done = (i: number) => {
        branchEl.innerHTML = '';
        city.clearChoices();
        window.removeEventListener('keydown', onKey);
        resolve(options[i].to);
      };
      const onKey = (e: KeyboardEvent) => {
        const i = +e.key - 1;
        if (i >= 0 && i < options.length) done(i);
      };
      branchEl.innerHTML = options
        .map((o, i) => `<button class="btn ${i === 0 ? 'primary' : ''}" data-b="${i}">${o.icon} ${esc(o.label)}</button>`)
        .join('');
      branchEl.onclick = (e) => {
        const b = (e.target as HTMLElement).closest<HTMLElement>('[data-b]');
        if (b) done(+b.dataset.b!);
      };
      city.showChoices(options, done);
      window.addEventListener('keydown', onKey);
    });

  const moveFruit = async (avoid: number) => {
    let next = fruitSpace;
    while (next === fruitSpace || next === avoid || next === 0) next = 1 + rand(board.spaces.length - 1);
    fruitSpace = next;
    city.setFruit(fruitSpace);
    city.focus(fruitSpace, 900);
    await sleep(1600);
  };

  const offerFruit = async (p: Player) => {
    if (p.coins < FRUIT_PRICE) {
      say(`🍍 Goldenes Obst kostet ${FRUIT_PRICE} 🪙 – ${esc(p.name)} hat zu wenig!`);
      await sleep(1500);
      return;
    }
    const pick = await ask(
      `<h2>🍍 Goldenes Obst!</h2><p>${esc(p.name)}, willst du es für <b>${FRUIT_PRICE} 🪙</b> kaufen?</p>`,
      ['Kaufen!', 'Nein danke'],
    );
    if (pick !== 0) return;
    p.fruits++;
    addCoins(p, -FRUIT_PRICE);
    say(`✨ ${esc(p.name)} schnappt sich ein Goldenes Obst! Es taucht woanders neu auf…`);
    await sleep(1200);
    await moveFruit(p.pos);
    city.focus(p.pos);
  };

  const runEvent = async (p: Player) => {
    const others = players.filter((o) => o !== p);
    const town = board.name.replace(/^\d+\s+/, '');
    const events: (() => Promise<void> | void)[] = [
      () => {
        say(`${board.neuhof ? '⛰️ Salz-Jackpot am Monte Kali' : `🎰 Jackpot in ${esc(town)}`}! ${esc(p.name)} bekommt 10 🪙`);
        addCoins(p, 10);
      },
      () => {
        say(`🥨 Die Bäckerei spendiert eine Runde: ${esc(p.name)} bekommt 6 🪙`);
        addCoins(p, 6);
      },
      () => {
        say(`🛒 Großeinkauf im Supermarkt! ${esc(p.name)} verliert 5 🪙`);
        addCoins(p, -5);
      },
      () => {
        say(`🚂 Zug verpasst in ${esc(town)} – ${esc(p.name)} zahlt 4 🪙 fürs Taxi`);
        addCoins(p, -4);
      },
      () => {
        say(`✈️ Bombardiro-Angriff über ${esc(town)}! Alle anderen verlieren 3 🪙`);
        others.forEach((o) => addCoins(o, -3));
      },
      async () => {
        say(`🚒 Die Feuerwehr fährt ${esc(p.name)} zurück zum ${board.neuhof ? 'Rathaus' : 'Start'}: +${LAP_BONUS} 🪙`);
        p.pos = 0;
        await city.moveToken(players.indexOf(p), 0, 1100);
        addCoins(p, LAP_BONUS);
        city.focus(0);
      },
      () => {
        const victim = [...others].sort((a, b) => b.coins - a.coins)[0];
        const n = Math.min(5, victim.coins);
        say(`🥷 ${esc(p.name)} klaut ${n} 🪙 von ${esc(victim.name)}!`);
        addCoins(victim, -n);
        addCoins(p, n);
      },
      async () => {
        const other = others[rand(others.length)];
        say(`🔀 Platztausch! ${esc(p.name)} tauscht mit ${esc(other.name)}`);
        [p.pos, other.pos] = [other.pos, p.pos];
        await Promise.all([
          city.moveToken(players.indexOf(p), p.pos, 900),
          city.moveToken(players.indexOf(other), other.pos, 900),
        ]);
        city.focus(p.pos);
      },
      async () => {
        say(`🌪️ Das Goldene Obst wird weggeweht!`);
        await sleep(900);
        await moveFruit(p.pos);
        city.focus(p.pos);
      },
    ];
    await events[rand(events.length)]();
  };

  const takeTurn = async (p: Player, i: number) => {
    current = i;
    renderHud();
    city.setActiveToken(i);
    city.focus(p.pos, 1100);
    diceEl.textContent = '';
    say(`<b>${p.char.emoji} ${esc(p.name)}</b> ist dran!`);
    await waitRoll();

    let n = 1;
    diceEl.classList.add('rolling');
    for (let k = 0; k < 12; k++) {
      n = 1 + rand(6);
      diceEl.textContent = DICE[n - 1];
      await sleep(70);
    }
    diceEl.classList.remove('rolling');
    say(`${esc(p.name)} würfelt eine <b>${n}</b>`);
    await sleep(600);

    for (let left = n; left > 0; left--) {
      const options = board.spaces[p.pos].next;
      p.pos = options.length > 1 ? await chooseBranch(p) : options[0].to;
      city.focus(p.pos, 320);
      await city.moveToken(i, p.pos);
      diceEl.textContent = left > 1 ? String(left - 1) : '';
      if (p.pos === 0) {
        say(`🏁 ${board.neuhof ? 'Am Rathaus' : 'Am Start'} vorbei: +${LAP_BONUS} 🪙`);
        addCoins(p, LAP_BONUS);
        await sleep(700);
      }
      if (p.pos === fruitSpace) await offerFruit(p);
      await sleep(90);
    }

    const type = board.spaces[p.pos].type;
    if (type === 'blue') {
      say(`🔵 Blaues Feld: +${BLUE_COINS} 🪙`);
      addCoins(p, BLUE_COINS);
    } else if (type === 'red') {
      say(`🔴 Rotes Feld: −${RED_COINS} 🪙`);
      addCoins(p, -RED_COINS);
    } else if (type === 'event') {
      say('❓ Ereignisfeld…');
      await sleep(900);
      await runEvent(p);
    }
    await sleep(1500);
  };

  // --- Ablauf
  city.reset();
  players.forEach((p, i) => city.addToken(i, p.char.art, p.char.color, p.pos));
  renderHud();
  say('Die Party beginnt! 🎉');
  city.overview(0, 1500);
  await sleep(1600);
  await moveFruit(0);

  for (round = 1; round <= rounds; round++) {
    for (let i = 0; i < players.length; i++) await takeTurn(players[i], i);

    current = -1;
    renderHud();
    city.setActiveToken(-1);
    say('Zeit für ein Minispiel!');
    city.overview(0, 1200);
    await sleep(900);
    const root = document.createElement('div');
    root.className = 'backdrop';
    overlay.append(root);
    const winners = await runMinigame(
      root,
      players.map((p) => ({ name: esc(p.name), emoji: p.char.art, color: p.char.color })),
    );
    root.remove();
    winners.forEach((w) => addCoins(players[w], MINIGAME_PRIZE));
    if (winners.length) {
      say(`🏆 +${MINIGAME_PRIZE} 🪙 für ${winners.map((w) => esc(players[w].name)).join(' & ')}`);
      await sleep(1600);
    }
  }

  // --- Ergebnis
  const ranking = [...players].sort((a, b) => b.fruits - a.fruits || b.coins - a.coins);
  hud.innerHTML = '';
  city.overview(0, 2500);
  overlay.innerHTML = `
    <div class="backdrop">
      <div class="panel modal results">
        <h1 class="logo"><span>Party</span> <span>vorbei!</span></h1>
        <p class="sub">👑 ${ranking[0].char.emoji} ${esc(ranking[0].name)} gewinnt!</p>
        ${ranking
          .map(
            (p, i) => `
          <div class="card rank" style="--c:${p.char.color}">
            <span class="place">${['🥇', '🥈', '🥉', '4.'][i]}</span>
            <span class="avatar">${p.char.art}</span>
            <div class="card-name">${esc(p.name)}<small>${p.char.name}</small></div>
            <div class="card-stats"><span>🍍 ${p.fruits}</span><span>🪙 ${p.coins}</span></div>
          </div>`,
          )
          .join('')}
        <button class="btn primary big-btn" id="again">Nochmal spielen</button>
      </div>
    </div>`;
  overlay.querySelector('#again')!.addEventListener('click', () => {
    city.reset();
    city.overview(panelPadding());
    renderSetup();
  });
}

renderSetup();
void city.ready.then(() => city.overview(panelPadding(), 4000));
// Für die Browser-Konsole beim Entwickeln
Object.assign(window, { city, getBoard: () => board });
