const assert = require('assert');
const { createGame, applyAction } = require('../game-server');

const identities = [
  { id: 'j1', name: 'J1' },
  { id: 'j2', name: 'J2' },
  { id: 'j3', name: 'J3' }
];

function card(id, type, suit, value, jokerNumber) {
  return { id, type, suit, value, jokerNumber };
}

function preparedGame(hands) {
  const game = createGame(identities, () => .42);
  game.phase = 'play';
  game.players.forEach((p, index) => { p.hand = hands[index]; p.tricks = 0; });
  game.leader = 'j1'; game.turn = 'j1'; game.direction = 1;
  game.trickNumber = 1; game.table = []; game.suitOrder = []; game.announcedSuit = null;
  return game;
}

// Sans joker : la couleur apparue le plus tard est prioritaire sur la valeur.
const colorGame = preparedGame([
  [card('spade-8', 'suit', 'spade', 8)],
  [card('spade-4', 'suit', 'spade', 4)],
  [card('diamond-2', 'suit', 'diamond', 2)]
]);
applyAction(colorGame, 'j1', { type: 'playCard', cardId: 'spade-8' });
applyAction(colorGame, 'j2', { type: 'playCard', cardId: 'spade-4' });
applyAction(colorGame, 'j3', { type: 'playCard', cardId: 'diamond-2' });
assert.deepStrictEqual(colorGame.suitOrder, ['spade', 'diamond']);
assert.strictEqual(colorGame.players.find(p => p.id === 'j3').tricks, 1, 'Le 2 de carreau doit gagner.');

// Le dernier pli reste visible jusqu a la première carte du pli suivant.
const retainedTrickGame = preparedGame([
  [card('club-5', 'suit', 'club', 5), card('heart-1', 'suit', 'heart', 1)],
  [card('club-4', 'suit', 'club', 4), card('heart-2', 'suit', 'heart', 2)],
  [card('club-3', 'suit', 'club', 3), card('heart-3', 'suit', 'heart', 3)]
]);
applyAction(retainedTrickGame, 'j1', { type: 'playCard', cardId: 'club-5' });
applyAction(retainedTrickGame, 'j2', { type: 'playCard', cardId: 'club-4' });
applyAction(retainedTrickGame, 'j3', { type: 'playCard', cardId: 'club-3' });
assert.strictEqual(retainedTrickGame.lastTrick.length, 3, 'Les trois cartes du pli gagné doivent rester visibles.');
assert.strictEqual(retainedTrickGame.lastTrickWinner, 'j1');
applyAction(retainedTrickGame, 'j1', { type: 'playCard', cardId: 'heart-1' });
assert.strictEqual(retainedTrickGame.lastTrick.length, 0, 'Le dernier pli doit disparaître à la première nouvelle carte.');
assert.strictEqual(retainedTrickGame.lastTrickWinner, null);

// À la troisième couleur différente, la quatrième complète automatiquement la priorité.
const completeOrderGame = preparedGame([
  [card('club-8', 'suit', 'club', 8)],
  [card('heart-4', 'suit', 'heart', 4)],
  [card('spade-2', 'suit', 'spade', 2)]
]);
applyAction(completeOrderGame, 'j1', { type: 'playCard', cardId: 'club-8' });
applyAction(completeOrderGame, 'j2', { type: 'playCard', cardId: 'heart-4' });
applyAction(completeOrderGame, 'j3', { type: 'playCard', cardId: 'spade-2' });
assert.deepStrictEqual(completeOrderGame.suitOrder, ['club', 'heart', 'spade', 'diamond']);

// Avec un joker : les valeurs redeviennent prioritaires, puis la couleur départage une égalité.
const jokerGame = preparedGame([
  [card('joker-4', 'joker', undefined, 4.5, 4)],
  [card('heart-6', 'suit', 'heart', 6)],
  [card('spade-5', 'suit', 'spade', 5)]
]);
applyAction(jokerGame, 'j1', { type: 'playCard', cardId: 'joker-4', announcedSuit: 'club' });
applyAction(jokerGame, 'j2', { type: 'playCard', cardId: 'heart-6' });
applyAction(jokerGame, 'j3', { type: 'playCard', cardId: 'spade-5' });
assert.strictEqual(jokerGame.players.find(p => p.id === 'j2').tricks, 1, 'Avec un joker, le 6 doit battre le 5.');

console.log('Priorité des couleurs et exception des jokers validées.');
