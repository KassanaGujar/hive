// Plain-language challenges: what ordinary people type, with the follow-ups they send after trying it. No file names,
// sizes, libraries or test hooks. Each message adds checks a person would care about; later messages re-check the
// earlier ones, so a follow-up that breaks what already worked shows up. Judged by tools/qa/tester.mjs.
export const PLAIN = [
  {
    id: 'snake',
    turns: [
      { say: 'make the snake game', checks: ['I can steer the snake with the arrow keys', 'Eating food makes the snake longer', 'Running into the wall or into myself ends the game', 'There is a score', 'I can play again after losing'] },
      { say: 'oh but make all the blocks change colours like a jeb_ sheep from minecraft', checks: ["The snake's blocks keep cycling through rainbow colours"] }
    ]
  },
  {
    id: 'tictactoe',
    turns: [
      { say: 'can you make tic tac toe so me and my brother can play on the same computer', checks: ['We take turns putting X and O on the board by clicking', 'It says who won when someone gets three in a row', 'It notices when the game is a draw', 'We can start a new game'] },
      { say: 'can it keep score of whos winning', checks: ['A scoreboard counts wins and goes up after someone wins', 'Starting a new game keeps the score'] }
    ]
  },
  {
    id: 'homework',
    turns: [
      { say: 'i need something to keep track of my homework', checks: ['I can add a homework item', 'I can mark an item as done or remove it'] },
      { say: 'let me drag stuff over to a done pile when i finish it', checks: ['I can drag an item into a done area'] },
      { say: 'it forgot everything when i closed it. make it remember', checks: ['My items are still there after closing and reopening the page'] }
    ]
  },
  {
    id: 'breakout',
    turns: [
      { say: 'make that game where you bounce a ball with a paddle and break bricks', checks: ['I can move the paddle', 'The ball bounces off the paddle and the walls', 'Bricks disappear when the ball hits them', 'I lose a life or the game when the ball falls past the paddle'] },
      { say: 'make the bricks explode into little pieces when you hit them', checks: ['Bricks burst into small pieces when they are hit'] }
    ]
  },
  {
    id: 'flappycat',
    turns: [
      { say: 'make a game like flappy bird but its a cat', checks: ['Pressing a key or clicking makes the cat flap upwards', 'The cat falls when I do nothing', 'There are gaps to fly through and the score goes up when I get through one', 'Hitting something ends the game and I can try again'] },
      { say: 'its way too hard, make it easier', checks: ['It is clearly easier than before (bigger gaps, slower, or gentler falling)'] }
    ]
  },
  {
    id: 'drawing',
    turns: [
      { say: 'make a drawing app for my little sister', checks: ['I can draw by dragging the mouse', 'I can pick different colours', 'I can clear the picture'] },
      { say: 'add a rainbow brush', checks: ['There is a rainbow brush that draws in changing colours'] }
    ]
  },
  {
    id: 'tips',
    turns: [
      { say: 'i need a tip calculator for when we go out to eat', checks: ['I can type in the bill and choose a tip, and it shows the tip and the total', 'The tip and total are correct'] },
      { say: 'can it split it between my friends too', checks: ['I can say how many people there are and it shows what each person pays', 'The amount per person is correct'] }
    ]
  },
  {
    id: 'quiz',
    turns: [
      { say: 'make an animal quiz for my class', checks: ['It asks questions about animals with answers to pick from', 'It tells me whether I got each one right'] },
      { say: 'show a score at the end and let them try again', checks: ['At the end it shows my score', 'I can try again from the start'] }
    ]
  }
]
