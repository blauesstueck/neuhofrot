export interface MiniPlayer {
  name: string;
  /** Figur als SVG-Markup */
  emoji: string;
  color: string;
}

const KEYS = ['a', 'l', 'v', 'n'];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Ctx {
  players: MiniPlayer[];
  stage: HTMLElement;
  /** Text unter dem Avatar eines Spielers setzen */
  setPad(i: number, text: string): void;
  disablePad(i: number): void;
  /** Callback für Tastendruck/Touch; gibt Abmelde-Funktion zurück */
  onPress(cb: (i: number) => void): () => void;
}

interface Minigame {
  title: string;
  icon: string;
  rules: string;
  play(ctx: Ctx): Promise<number[]>;
}

const smash: Minigame = {
  title: 'Sahur-Smash',
  icon: '🥁',
  rules: 'Hämmere 6 Sekunden lang so oft du kannst auf deine Taste!',
  async play(ctx) {
    const counts = ctx.players.map(() => 0);
    ctx.players.forEach((_, i) => ctx.setPad(i, '0'));
    const off = ctx.onPress((i) => {
      counts[i]++;
      ctx.setPad(i, String(counts[i]));
    });
    const total = 6000;
    const t0 = performance.now();
    while (performance.now() - t0 < total) {
      ctx.stage.innerHTML = `<div class="big">${((total - (performance.now() - t0)) / 1000).toFixed(1)}s</div>`;
      await sleep(50);
    }
    off();
    ctx.stage.innerHTML = '<div class="big">Stopp!</div>';
    const max = Math.max(...counts);
    return max === 0 ? [] : counts.flatMap((c, i) => (c === max ? [i] : []));
  },
};

const reaction: Minigame = {
  title: 'Brainrot-Reflex',
  icon: '⚡',
  rules: 'Warte auf das Signal – wer danach zuerst drückt, gewinnt. Zu früh = raus!',
  async play(ctx) {
    ctx.players.forEach((_, i) => ctx.setPad(i, 'bereit'));
    ctx.stage.innerHTML = '<div class="big">Warte…</div>';
    let go = false;
    const out = new Set<number>();
    return new Promise<number[]>((resolve) => {
      const finish = (winners: number[]) => {
        off();
        clearTimeout(signal);
        clearTimeout(timeout);
        resolve(winners);
      };
      const off = ctx.onPress((i) => {
        if (out.has(i)) return;
        if (go) {
          ctx.setPad(i, 'ERSTER!');
          finish([i]);
        } else {
          out.add(i);
          ctx.setPad(i, 'zu früh 💀');
          ctx.disablePad(i);
          if (out.size === ctx.players.length) finish([]);
        }
      });
      let timeout = 0;
      const signal = window.setTimeout(() => {
        go = true;
        ctx.stage.innerHTML = '<div class="big go">JETZT!</div>';
        timeout = window.setTimeout(() => finish([]), 5000);
      }, 2000 + Math.random() * 4000);
    });
  },
};

const stopwatch: Minigame = {
  title: 'Stopp die Uhr',
  icon: '⏱️',
  rules: 'Die Uhr verschwindet nach kurzer Zeit. Drücke genau bei der Zielzeit!',
  async play(ctx) {
    const target = 4 + Math.floor(Math.random() * 4);
    const times: (number | null)[] = ctx.players.map(() => null);
    ctx.players.forEach((_, i) => ctx.setPad(i, '…'));
    const t0 = performance.now();
    const off = ctx.onPress((i) => {
      if (times[i] !== null) return;
      times[i] = (performance.now() - t0) / 1000;
      ctx.setPad(i, 'gestoppt ✔');
      ctx.disablePad(i);
    });
    while (times.some((t) => t === null) && performance.now() - t0 < (target + 4) * 1000) {
      const t = (performance.now() - t0) / 1000;
      ctx.stage.innerHTML = `<div class="small">Ziel: ${target},00 s</div><div class="big">${t < 1.5 ? t.toFixed(2) : '?,??'}</div>`;
      await sleep(30);
    }
    off();
    const diffs = times.map((t) => (t === null ? Infinity : Math.abs(t - target)));
    times.forEach((t, i) => ctx.setPad(i, t === null ? 'verpennt' : `${t.toFixed(2)} s`));
    ctx.stage.innerHTML = `<div class="small">Ziel: ${target},00 s</div><div class="big">Zeit!</div>`;
    const best = Math.min(...diffs);
    return best === Infinity ? [] : diffs.flatMap((d, i) => (d === best ? [i] : []));
  },
};

const GAMES = [smash, reaction, stopwatch];
let lastGame = -1;

/** Spielt ein zufälliges Minispiel im Container und liefert die Gewinner-Indizes. */
export async function runMinigame(root: HTMLElement, players: MiniPlayer[]): Promise<number[]> {
  let g = Math.floor(Math.random() * GAMES.length);
  if (g === lastGame) g = (g + 1) % GAMES.length;
  lastGame = g;
  const game = GAMES[g];

  root.innerHTML = `
    <div class="panel mini">
      <div class="mini-tag">Minispiel</div>
      <h2>${game.icon} ${game.title}</h2>
      <p class="rules">${game.rules}</p>
      <div class="stage"><button class="btn primary" id="mini-go">Los geht's!</button></div>
      <div class="pads">
        ${players
          .map(
            (p, i) => `
          <button class="pad" data-i="${i}" style="--c:${p.color}">
            <span class="pad-emoji">${p.emoji}</span>
            <span class="pad-name">${p.name}</span>
            <span class="pad-key">Taste ${KEYS[i].toUpperCase()}</span>
            <span class="pad-text"></span>
          </button>`,
          )
          .join('')}
      </div>
    </div>`;

  const stage = root.querySelector<HTMLElement>('.stage')!;
  const pads = [...root.querySelectorAll<HTMLButtonElement>('.pad')];
  const listeners = new Set<(i: number) => void>();
  const disabled = new Set<number>();
  const press = (i: number) => {
    if (disabled.has(i)) return;
    pads[i].classList.remove('hit');
    void pads[i].offsetWidth;
    pads[i].classList.add('hit');
    listeners.forEach((cb) => cb(i));
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.repeat) return;
    const i = KEYS.indexOf(e.key.toLowerCase());
    if (i >= 0 && i < players.length) press(i);
  };
  window.addEventListener('keydown', onKey);
  pads.forEach((pad, i) =>
    pad.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      press(i);
    }),
  );

  const ctx: Ctx = {
    players,
    stage,
    setPad: (i, text) => (pads[i].querySelector('.pad-text')!.textContent = text),
    disablePad: (i) => {
      disabled.add(i);
      pads[i].classList.add('off');
    },
    onPress: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };

  await new Promise<void>((resolve) =>
    root.querySelector('#mini-go')!.addEventListener('click', () => resolve(), { once: true }),
  );
  for (const n of ['3', '2', '1']) {
    stage.innerHTML = `<div class="big">${n}</div>`;
    await sleep(700);
  }

  const winners = await game.play(ctx);
  window.removeEventListener('keydown', onKey);
  pads.forEach((pad, i) => pad.classList.toggle('winner', winners.includes(i)));
  await sleep(900);
  const text = winners.length
    ? `🏆 ${winners.map((i) => players[i].name).join(' & ')} ${winners.length > 1 ? 'gewinnen' : 'gewinnt'}!`
    : 'Niemand gewinnt 😬';
  stage.innerHTML = `<div class="small">${text}</div><button class="btn primary" id="mini-done">Weiter</button>`;
  await new Promise<void>((resolve) =>
    root.querySelector('#mini-done')!.addEventListener('click', () => resolve(), { once: true }),
  );
  return winners;
}
