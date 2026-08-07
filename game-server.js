'use strict';

const SUITS = ['club', 'spade', 'diamond', 'heart'];

function shuffle(items, random = Math.random) {
  const array = [...items];
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function makeDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (let value = 1; value <= 10; value++) deck.push({ id: `${suit}-${value}`, type: 'suit', suit, value });
  }
  for (let value = 1; value <= 8; value++) deck.push({ id: `joker-${value}`, type: 'joker', value: value + .5, jokerNumber: value });
  deck.push({ id: 'role-1', type: 'role', value: 0 }, { id: 'role-2', type: 'role', value: 0 });
  return deck;
}

function sortHand(hand) {
  const types = { suit: 0, joker: 1, role: 2 };
  const suits = { club: 0, spade: 1, diamond: 2, heart: 3 };
  return [...hand].sort((a, b) => types[a.type] - types[b.type] || (suits[a.suit] ?? 9) - (suits[b.suit] ?? 9) || a.value - b.value);
}

function createGame(roomPlayers, random = Math.random) {
  let hands;
  do {
    const playable = shuffle(makeDeck().filter(c => c.type !== 'role'), random);
    playable.splice(0, 2);
    const deck = shuffle([...playable, ...makeDeck().filter(c => c.type === 'role')], random);
    hands = [deck.slice(0, 16), deck.slice(16, 32), deck.slice(32, 48)];
  } while (hands.some(hand => hand.filter(c => c.type === 'role').length === 2));

  const first = Math.floor(random() * 3);
  return {
    phase: 'initialPass',
    players: roomPlayers.map((player, index) => ({ id: player.id, name: player.name, avatar: player.avatar || 'avatar-1', seat: index, hand: sortHand(hands[index]), tricks: 0, points: 0 })),
    leader: roomPlayers[first].id,
    turn: roomPlayers[first].id,
    direction: 1,
    trickNumber: 1,
    table: [],
    lastTrick: [],
    lastTrickWinner: null,
    suitOrder: [],
    announcedSuit: null,
    passes: {},
    effect: null,
    log: [`${roomPlayers[first].name} entamera le premier pli.`]
  };
}

function player(game, id) { return game.players.find(p => p.id === id); }
function seat(game, id) { return player(game, id).seat; }
function nextPlayer(game, id) { return game.players[(seat(game, id) + game.direction + 3) % 3].id; }
function error(message) { const err = new Error(message); err.expose = true; throw err; }
function ensure(condition, message) { if (!condition) error(message); }

function legalCards(game, hand) {
  const playable = hand.filter(c => c.type !== 'role');
  if (!game.table.length) return playable;
  const lead = game.table[0].card;
  const required = lead.type === 'joker' ? game.announcedSuit : lead.suit;
  const hasRequired = hand.some(c => c.type === 'suit' && c.suit === required);
  if (!hasRequired) return playable;
  if (lead.type === 'joker') return playable.filter(c => c.type === 'suit' && c.suit === required);
  return playable.filter(c => c.type === 'joker' || (c.type === 'suit' && c.suit === required));
}

function applyAction(game, playerId, action, random = Math.random) {
  ensure(game.phase !== 'done', 'Cette partie est terminée.');
  ensure(player(game, playerId), 'Joueur inconnu.');
  switch (action.type) {
    case 'submitPass': return submitPass(game, playerId, action.cardIds);
    case 'playCard': return playCard(game, playerId, action.cardId, action.announcedSuit);
    case 'clubDirection': return clubDirection(game, playerId, action.direction);
    case 'effectTarget': return effectTarget(game, playerId, action.targetId, random);
    case 'diamondGive': return diamondGive(game, playerId, action.cardId);
    default: error('Action inconnue.');
  }
}

function submitPass(game, playerId, cardIds) {
  ensure(game.phase === 'initialPass' || game.phase === 'clubPass', 'Aucun échange en cours.');
  ensure(!game.passes[playerId], 'Vous avez déjà validé votre échange.');
  ensure(Array.isArray(cardIds) && new Set(cardIds).size === 2, 'Choisissez exactement deux cartes.');
  const p = player(game, playerId);
  const cards = cardIds.map(id => p.hand.find(c => c.id === id));
  ensure(cards.every(Boolean), 'Une carte choisie ne se trouve plus dans votre main.');
  if (game.phase === 'initialPass' && p.hand.filter(c => c.type === 'joker').length >= 3) {
    ensure(cards.some(c => c.type === 'joker'), 'Vous devez inclure au moins un joker.');
  }
  game.passes[playerId] = [...cardIds];
  if (Object.keys(game.passes).length === 3) executePasses(game);
}

function executePasses(game) {
  const direction = game.phase === 'initialPass' ? 1 : game.effect.passDirection;
  const packets = game.players.map(p => p.hand.filter(c => game.passes[p.id].includes(c.id)));
  game.players.forEach(p => { p.hand = p.hand.filter(c => !game.passes[p.id].includes(c.id)); });
  game.players.forEach((p, index) => {
    const target = game.players[(index + direction + 3) % 3];
    target.hand.push(...packets[index]);
    target.hand = sortHand(target.hand);
  });
  game.log.push(`Échange de deux cartes vers ${direction === 1 ? 'la gauche' : 'la droite'}.`);
  game.passes = {};
  if (game.phase === 'initialPass') game.phase = 'play';
  else finishEffect(game);
}

function playCard(game, playerId, cardId, announcedSuit) {
  ensure(game.phase === 'play', 'Ce n’est pas le moment de jouer une carte.');
  ensure(game.turn === playerId, 'Ce n’est pas votre tour.');
  const p = player(game, playerId);
  const card = p.hand.find(c => c.id === cardId);
  ensure(card && legalCards(game, p.hand).some(c => c.id === cardId), 'Cette carte ne peut pas être jouée.');
  if (!game.table.length) {
    game.lastTrick = [];
    game.lastTrickWinner = null;
  }
  if (!game.table.length && card.type === 'joker') {
    ensure(SUITS.includes(announcedSuit), 'Annoncez une couleur.');
    game.announcedSuit = announcedSuit;
  }
  p.hand = p.hand.filter(c => c.id !== cardId);
  game.table.push({ player: playerId, card });
  if (card.type === 'suit') addSuitPriority(game.suitOrder, card.suit);
  game.log.push(`${p.name} joue ${cardLabel(card)}.`);
  if (game.table.length < 3) game.turn = nextPlayer(game, playerId);
  else resolveTrick(game);
}

function addSuitPriority(suitOrder, suit) {
  if (suitOrder.includes(suit)) return;
  suitOrder.push(suit);
  if (suitOrder.length === SUITS.length - 1) {
    suitOrder.push(SUITS.find(candidate => !suitOrder.includes(candidate)));
  }
}

function compareCards(game, a, b) {
  const jokerPlayed = game.table.some(play => play.card.type === 'joker');
  if (!jokerPlayed && a.type === 'suit' && b.type === 'suit' && a.suit !== b.suit) {
    return game.suitOrder.indexOf(a.suit) - game.suitOrder.indexOf(b.suit);
  }
  if (a.value !== b.value) return a.value - b.value;
  if (a.type === 'suit' && b.type === 'suit') return game.suitOrder.indexOf(a.suit) - game.suitOrder.indexOf(b.suit);
  return 0;
}

function resolveTrick(game) {
  const winner = [...game.table].sort((a, b) => compareCards(game, b.card, a.card))[0].player;
  game.lastTrick = game.table.map(play => ({ player: play.player, card: { ...play.card } }));
  game.lastTrickWinner = winner;
  player(game, winner).tricks++;
  game.leader = winner;
  game.turn = winner;
  game.log.push(`${player(game, winner).name} remporte le pli ${game.trickNumber}.`);
  const effectSuit = getEffectSuit(game);
  if (!effectSuit) return finishTrick(game);
  if (effectSuit === 'heart') {
    game.suitOrder = [];
    game.direction *= -1;
    game.log.push('La priorité est remise à zéro et le sens du jeu s’inverse.');
    return finishTrick(game);
  }
  if (effectSuit === 'spade' && !game.players.some(p => p.id !== winner && p.tricks > 0)) {
    game.direction *= -1;
    game.log.push('Aucun pli adverse à voler. Le sens du jeu s’inverse.');
    return finishTrick(game);
  }
  game.phase = 'effectChoice';
  game.effect = { suit: effectSuit, winner, stage: { club: 'clubDirection', spade: 'spadeTarget', diamond: 'diamondTarget' }[effectSuit] };
}

function getEffectSuit(game) {
  if (!game.table.some(play => play.card.type === 'joker')) return null;
  const lead = game.table[0].card;
  if (lead.type === 'suit') return lead.suit;
  return game.table.find(play => play.card.type === 'suit')?.card.suit || null;
}

function requireWinner(game, playerId) {
  ensure(game.phase === 'effectChoice' && game.effect?.winner === playerId, 'Vous ne pouvez pas résoudre ce pouvoir.');
}

function clubDirection(game, playerId, direction) {
  requireWinner(game, playerId);
  ensure(game.effect.stage === 'clubDirection' && [1, -1].includes(direction), 'Choisissez un sens valide.');
  game.effect.passDirection = direction;
  game.phase = 'clubPass';
  game.passes = {};
}

function effectTarget(game, playerId, targetId, random) {
  requireWinner(game, playerId);
  const target = player(game, targetId);
  ensure(target && targetId !== playerId, 'Choisissez un adversaire.');
  if (game.effect.stage === 'spadeTarget') {
    ensure(target.tricks > 0, 'Cet adversaire n’a aucun pli à voler.');
    target.tricks--;
    player(game, playerId).tricks++;
    game.log.push(`${player(game, playerId).name} vole un pli à ${target.name}.`);
    return finishEffect(game);
  }
  ensure(game.effect.stage === 'diamondTarget', 'Cette cible n’est pas attendue.');
  ensure(target.hand.length > 0, 'Cette main est vide.');
  const stolen = target.hand[Math.floor(random() * target.hand.length)];
  target.hand = target.hand.filter(c => c.id !== stolen.id);
  player(game, playerId).hand.push(stolen);
  player(game, playerId).hand = sortHand(player(game, playerId).hand);
  game.effect.target = targetId;
  game.effect.stage = 'diamondGive';
  game.log.push(`${player(game, playerId).name} prend une carte au hasard à ${target.name}.`);
}

function diamondGive(game, playerId, cardId) {
  requireWinner(game, playerId);
  ensure(game.effect.stage === 'diamondGive', 'Aucune carte n’est attendue.');
  const p = player(game, playerId);
  const card = p.hand.find(c => c.id === cardId);
  ensure(card, 'Cette carte ne se trouve plus dans votre main.');
  p.hand = p.hand.filter(c => c.id !== cardId);
  const target = player(game, game.effect.target);
  target.hand.push(card);
  target.hand = sortHand(target.hand);
  game.log.push(`${p.name} rend une carte à ${target.name}.`);
  finishEffect(game);
}

function finishEffect(game) {
  game.direction *= -1;
  game.log.push(`Le sens du jeu est maintenant ${game.direction === 1 ? 'horaire' : 'antihoraire'}.`);
  game.effect = null;
  finishTrick(game);
}

function finishTrick(game) {
  game.table = [];
  game.announcedSuit = null;
  if (game.trickNumber >= 13) return finishGame(game);
  game.trickNumber++;
  game.phase = 'play';
  game.turn = game.leader;
  game.effect = null;
}

function finishGame(game) {
  const max = Math.max(...game.players.map(p => p.tricks));
  const min = Math.min(...game.players.map(p => p.tricks));
  game.players.forEach(p => {
    const roles = p.hand.filter(c => c.type === 'role').length;
    p.points = roles ? (p.tricks === max ? roles : 0) : (p.tricks === min ? 1 : 0);
  });
  game.phase = 'done';
  game.effect = null;
}

function publicGameFor(game, playerId) {
  const own = player(game, playerId);
  return {
    phase: game.phase,
    you: playerId,
    hand: own ? own.hand : [],
    roleCount: own ? own.hand.filter(c => c.type === 'role').length : 0,
    players: game.players.map(p => ({
      id: p.id, name: p.name, avatar: p.avatar, seat: p.seat, handCount: p.hand.length, tricks: p.tricks, points: game.phase === 'done' ? p.points : undefined,
      roleCount: game.phase === 'done' ? p.hand.filter(c => c.type === 'role').length : undefined
    })),
    leader: game.leader,
    turn: game.turn,
    direction: game.direction,
    trickNumber: game.trickNumber,
    table: game.table,
    lastTrick: game.lastTrick || [],
    lastTrickWinner: game.lastTrickWinner || null,
    suitOrder: game.suitOrder,
    announcedSuit: game.announcedSuit,
    passSubmitted: Object.keys(game.passes),
    effect: game.effect ? { ...game.effect } : null,
    log: game.log.slice(-10)
  };
}

function cardLabel(card) {
  if (card.type === 'role') return 'une carte Brigand';
  if (card.type === 'joker') return `le joker ${card.jokerNumber}+`;
  const labels = { club: 'trèfle', spade: 'pique', diamond: 'carreau', heart: 'cœur' };
  return `${card.value} de ${labels[card.suit]}`;
}

module.exports = { createGame, applyAction, publicGameFor, legalCards };
