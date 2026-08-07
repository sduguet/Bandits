const { fork } = require('child_process');
const { io } = require('socket.io-client');
const assert = require('assert');

const port = 31991;
const server = fork('server.js', [], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
const clients = [];
const views = [];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const emit = (socket, event, data) => new Promise((resolve, reject) => socket.emit(event, data, response => response?.ok ? resolve(response) : reject(new Error(response?.error || `${event} refusé`))));

function legal(game) {
  const playable = game.hand.filter(c => c.type !== 'role');
  if (!game.table.length) return playable;
  const lead = game.table[0].card;
  const required = lead.type === 'joker' ? game.announcedSuit : lead.suit;
  const has = game.hand.some(c => c.type === 'suit' && c.suit === required);
  if (!has) return playable;
  if (lead.type === 'joker') return playable.filter(c => c.type === 'suit' && c.suit === required);
  return playable.filter(c => c.type === 'joker' || (c.type === 'suit' && c.suit === required));
}

async function act(index, action) {
  await emit(clients[index], 'game:action', action);
  await wait(8);
}

(async () => {
  try {
    await wait(350);
    for (let i = 0; i < 3; i++) {
      const socket = io(`http://localhost:${port}`, { transports: ['websocket'] });
      clients.push(socket);
      socket.on('room:update', data => { views[i] = data; });
      await new Promise(resolve => socket.on('connect', resolve));
    }
    const created = await emit(clients[0], 'room:create', { name: 'Alice', avatar: 'avatar-2' });
    await emit(clients[1], 'room:join', { name: 'Bastien', avatar: 'avatar-7', code: created.code });
    await emit(clients[2], 'room:join', { name: 'Chloé', avatar: '../interdit', code: created.code });
    await emit(clients[0], 'room:start', {});
    await wait(20);
    assert(views.every(v => v.players.length === 3 && v.started), 'Le salon doit réunir trois joueurs.');
    assert.deepStrictEqual(views[0].players.map(p => p.avatar), ['avatar-2', 'avatar-7', 'avatar-1'], 'Les avatars doivent être transmis et validés.');
    assert.deepStrictEqual(views[0].game.players.map(p => p.avatar), ['avatar-2', 'avatar-7', 'avatar-1'], 'Les avatars doivent rester visibles pendant la partie.');

    let guard = 0;
    while (views[0].game.phase !== 'done' && guard++ < 500) {
      const phase = views[0].game.phase;
      if (phase === 'initialPass' || phase === 'clubPass') {
        for (let i = 0; i < 3; i++) {
          const g = views[i].game;
          if (g.passSubmitted.includes(g.you)) continue;
          const mustJoker = phase === 'initialPass' && g.hand.filter(c => c.type === 'joker').length >= 3;
          const first = mustJoker ? g.hand.find(c => c.type === 'joker') : g.hand[0];
          const second = g.hand.find(c => c.id !== first.id);
          await act(i, { type: 'submitPass', cardIds: [first.id, second.id] });
        }
        continue;
      }
      if (phase === 'effectChoice') {
        const g = views[0].game;
        const winner = g.effect.winner;
        const index = views.findIndex(v => v.you === winner);
        const own = views[index].game;
        if (g.effect.stage === 'clubDirection') await act(index, { type: 'clubDirection', direction: 1 });
        else if (g.effect.stage === 'spadeTarget') {
          const target = own.players.find(p => p.id !== winner && p.tricks > 0);
          if (target) await act(index, { type: 'effectTarget', targetId: target.id });
          else throw new Error('Pouvoir pique sans cible : cas serveur non résolu.');
        } else if (g.effect.stage === 'diamondTarget') {
          const target = own.players.find(p => p.id !== winner);
          await act(index, { type: 'effectTarget', targetId: target.id });
        } else if (g.effect.stage === 'diamondGive') {
          await act(index, { type: 'diamondGive', cardId: own.hand[0].id });
        }
        continue;
      }
      const turn = views[0].game.turn;
      const index = views.findIndex(v => v.you === turn);
      const g = views[index].game;
      const card = legal(g)[0];
      await act(index, { type: 'playCard', cardId: card.id, announcedSuit: !g.table.length && card.type === 'joker' ? 'club' : undefined });
    }
    assert(guard < 500, 'La partie en ligne doit se terminer.');
    assert(views.every(v => v.game.phase === 'done'), 'Tous les joueurs reçoivent le résultat.');
    assert(views[0].game.players.reduce((sum, p) => sum + p.tricks, 0) === 13, 'Il doit rester 13 plis au total.');
    assert(views.every(v => v.game.hand.length === 3), 'Chaque joueur doit finir avec trois cartes.');
    console.log(`Salon ${created.code} et partie à trois simulés avec succès.`);
  } finally {
    clients.forEach(c => c.close());
    server.kill();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
