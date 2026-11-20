// Coding challenges (Phases 6–8). Each has: the natural-language brief given to Hive's AI, and a probe
// that checks every checklist item in the generated app. Briefs ask for a small test hook so features
// can be verified mechanically (same as a QA team asking developers for testability).
// Probe bodies run inside the page (see pagecheck.cjs) and return { "<checklist item>": true | "why not" }.

const HOOK_NOTE = 'Use plain browser JavaScript (no build step, no npm packages). Keep game logic deterministic and exposed for testing exactly as described.'

export const CHALLENGES = [
  {
    id: 'snake', phase: 'P6', title: '1. Snake Game', kind: 'web',
    brief: `Build a complete Snake game in index.html + game.js (canvas, 20x20 grid, dark theme, score on screen, game-over message and a Restart button, arrow keys to steer).
Expose window.game with: state() returning {snake:[{x,y},...] (head first), food:{x,y}, dir:'up'|'down'|'left'|'right', score, over:boolean, cols:20, rows:20};
step() advances exactly one tick; setDir(d); reset() restarts (snake length 3 in the middle, moving right, score 0); pause() stops the automatic timer; placeFood(x,y) puts food at a cell.
Rules: eating food grows the snake by 1 and adds 1 to score and spawns new food on a free cell; hitting a wall or itself sets over=true and the snake stops moving; reversing direction directly is ignored. ${HOOK_NOTE}`,
    items: ['Create a playable Snake game', 'Directional movement', 'Food generation', 'Snake growth', 'Wall collision', 'Self-collision', 'Score tracking', 'Game-over functionality', 'Restart functionality', 'The game runs without errors'],
    probe: `
const g=window.game,R={};if(!g)return {'Create a playable Snake game':'window.game missing'};
const S=()=>JSON.parse(JSON.stringify(g.state()));
g.reset();await new Promise(r=>setTimeout(r,50));const t0=S().snake[0];await new Promise(r=>setTimeout(r,600));const t1=S().snake[0];
R['Create a playable Snake game']=!!document.querySelector('canvas')&&(t0.x!==t1.x||t0.y!==t1.y)||'no canvas or snake does not move on its own';
g.pause();g.reset();g.pause();
let h=S().snake[0];g.setDir('down');g.step();let h2=S().snake[0];
document.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));window.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));g.step();const h3=S().snake[0];
R['Directional movement']=(h2.y===h.y+1&&h2.x===h.x&&h3.x===h2.x-1)||'down then ArrowLeft: '+JSON.stringify([h,h2,h3]);
g.reset();g.pause();let s=S();const f=s.food;const onSnake=s.snake.some(p=>p.x===f.x&&p.y===f.y);
R['Food generation']=(f&&f.x>=0&&f.x<s.cols&&f.y>=0&&f.y<s.rows&&!onSnake)||'food '+JSON.stringify(f);
g.reset();g.pause();s=S();h=s.snake[0];g.placeFood(h.x+1,h.y);const len=s.snake.length,sc=s.score;g.step();s=S();
R['Snake growth']=s.snake.length===len+1||'length '+len+'→'+s.snake.length;
R['Score tracking']=s.score===sc+1||'score '+sc+'→'+s.score;
const nf=s.food;R['Food generation']=R['Food generation']===true&&!(nf.x===h.x+1&&nf.y===h.y)?true:R['Food generation']===true?'no new food after eating':R['Food generation'];
g.reset();g.pause();let n=0;while(!S().over&&n<40){g.step();n++}
R['Wall collision']=S().over||'never hit the wall in 40 steps';
const hs=S().snake[0];g.step();const hs2=S().snake[0];
R['Game-over functionality']=(S().over&&hs.x===hs2.x&&hs.y===hs2.y&&/game over/i.test(document.body.innerText))||'over='+S().over+' moved after over='+(hs.x!==hs2.x||hs.y!==hs2.y)+' message='+/game over/i.test(document.body.innerText);
g.reset();g.pause();for(let i=0;i<3;i++){const hh=S().snake[0];g.placeFood(hh.x+1,hh.y);g.step()}
g.setDir('down');g.step();g.setDir('left');g.step();g.setDir('up');g.step();
R['Self-collision']=S().over||'length '+S().snake.length+' looped into itself without game over';
g.reset();s=S();R['Restart functionality']=(!s.over&&s.score===0&&s.snake.length===3)||JSON.stringify({over:s.over,score:s.score,len:s.snake.length});
const btn=[...document.querySelectorAll('button')].find(b=>/restart|play again|new game/i.test(b.textContent));if(!btn&&R['Restart functionality']===true)R['Restart functionality']='no Restart button';
return R`
  },
  {
    id: 'tictactoe', phase: 'P6', title: '2. Tic-Tac-Toe', kind: 'web',
    brief: `Build a two-player Tic-Tac-Toe game in index.html + app.js with a 3x3 board of clickable cells (elements with class "cell" and data-index 0-8), a status line showing whose turn it is, a scoreboard (X wins, O wins, draws) and a Restart button that clears the board but keeps the score.
Expose window.game with: state() → {board:[9 values 'X'|'O'|null], turn:'X'|'O', winner:null|'X'|'O'|'draw', score:{X,O,draw}}; play(i) → true if the move was made, false if illegal (occupied cell or game finished); reset(). X always starts. ${HOOK_NOTE}`,
    items: ['A functional game board', 'Two-player gameplay', 'Turn management', 'Detects winning combinations', 'Detects draws', 'A scoreboard', 'Restart functionality', 'Illegal moves are prevented'],
    probe: `
const g=window.game,R={};if(!g)return {'A functional game board':'window.game missing'};const S=()=>JSON.parse(JSON.stringify(g.state()));
const cells=document.querySelectorAll('.cell');R['A functional game board']=cells.length===9||cells.length+' cells';
g.reset();cells[4]&&cells[4].click();let s=S();R['Two-player gameplay']=(s.board[4]==='X')||'clicking a cell did not place X';
R['Turn management']=s.turn==='O'||'turn after X is '+s.turn;
g.play(0);s=S();R['Two-player gameplay']=R['Two-player gameplay']===true&&s.board[0]==='O'?true:R['Two-player gameplay'];
R['Illegal moves are prevented']=(g.play(4)===false&&S().board[4]==='X'&&S().turn===s.turn)||'replaying an occupied cell was accepted';
g.reset();const sx=S().score.X;[0,3,1,4,2].forEach(i=>g.play(i));s=S();
R['Detects winning combinations']=s.winner==='X'||'winner after top row: '+s.winner;
const afterWin=g.play(8);R['Illegal moves are prevented']=R['Illegal moves are prevented']===true&&afterWin===false?true:(R['Illegal moves are prevented']===true?'moves accepted after the game was won':R['Illegal moves are prevented']);
R['A scoreboard']=(s.score.X===sx+1&&/\\d/.test(document.body.innerText))||'X score '+sx+'→'+s.score.X;
g.reset();const d=S().score.draw;[0,1,2,4,3,5,7,6,8].forEach(i=>g.play(i));s=S();R['Detects draws']=(s.winner==='draw'&&s.score.draw===d+1)||'winner='+s.winner;
const btn=[...document.querySelectorAll('button')].find(b=>/restart|reset|new game|play again/i.test(b.textContent));btn&&btn.click();s=S();
R['Restart functionality']=(btn&&s.board.every(c=>!c)&&s.score.draw===d+1)||(btn?'board not cleared or score lost':'no Restart button');
return R`
  },
  {
    id: 'invaders', phase: 'P6', title: '3. Space Invaders', kind: 'web',
    brief: `Build a Space Invaders game in index.html + game.js on a 480x640 canvas: player ship at the bottom (arrow keys move, Space shoots), a formation of at least 4 rows x 8 aliens that marches sideways and steps down, score, 3 lives, levels that get faster, game over screen and restart with Enter or a button.
Expose window.game with: state() returning the LIVE state object {player:{x,y,w,h}, enemies:[{x,y,w,h,alive}], bullets:[{x,y,vy}], score, lives, level, enemySpeed, over}; pause() stops the timer; step() advances one tick; moveLeft(); moveRight(); shoot(); reset().
Rules: a player bullet that overlaps a live enemy kills it (+10 score) and disappears; an enemy overlapping the player costs a life and resets the formation; when all enemies are dead the next level starts with a faster enemySpeed; lives reaching 0 sets over=true. ${HOOK_NOTE}`,
    items: ['Player movement', 'Projectile shooting', 'Enemy formations', 'Projectile collisions', 'Player-enemy collisions', 'Scoring', 'Increasing difficulty', 'Game-over and restart states'],
    probe: `
const g=window.game,R={};if(!g)return {'Player movement':'window.game missing'};g.pause();g.reset();g.pause();let s=g.state();
const x0=s.player.x;g.moveRight();g.moveRight();const x1=g.state().player.x;g.moveLeft();R['Player movement']=(x1>x0&&g.state().player.x<x1)||'x '+x0+'→'+x1;
const nb=s.bullets.length;g.shoot();s=g.state();const b=s.bullets[s.bullets.length-1];const by=b&&b.y;g.step();
R['Projectile shooting']=(s.bullets.length>nb&&b&&g.state().bullets.some(q=>q.y<by))||'no bullet or bullet does not move up';
const rows=new Set(s.enemies.map(e=>Math.round(e.y)));R['Enemy formations']=(s.enemies.length>=32&&rows.size>=4)||s.enemies.length+' enemies in '+rows.size+' rows';
g.reset();g.pause();s=g.state();const target=s.enemies.filter(e=>e.alive).sort((a,b)=>b.y-a.y)[0];s.player.x=target.x+target.w/2-s.player.w/2;
const alive0=s.enemies.filter(e=>e.alive).length,score0=s.score;g.shoot();{const q=g.state().bullets[g.state().bullets.length-1];if(q){q.x=target.x+target.w/2-(q.w||4)/2;q.y=target.y+target.h+2}}for(let i=0;i<400&&g.state().enemies.filter(e=>e.alive).length===alive0;i++){g.step()}
s=g.state();R['Projectile collisions']=s.enemies.filter(e=>e.alive).length===alive0-1||'enemy count '+alive0+'→'+s.enemies.filter(e=>e.alive).length;
R['Scoring']=s.score===score0+10||'score '+score0+'→'+s.score;
g.reset();g.pause();s=g.state();const lives0=s.lives;const e=s.enemies.find(q=>q.alive);e.x=s.player.x;e.y=s.player.y;g.step();
R['Player-enemy collisions']=g.state().lives===lives0-1||g.state().over||'lives '+lives0+'→'+g.state().lives;
g.reset();g.pause();s=g.state();const lv=s.level,sp=s.enemySpeed;s.enemies.forEach(q=>q.alive=false);for(let i=0;i<5;i++)g.step();s=g.state();
R['Increasing difficulty']=(s.level===lv+1&&Math.abs(s.enemySpeed)>Math.abs(sp)&&s.enemies.some(q=>q.alive))||'level '+lv+'→'+s.level+', speed '+sp+'→'+s.enemySpeed;
g.reset();g.pause();s=g.state();s.lives=1;const e2=s.enemies.find(q=>q.alive);e2.x=s.player.x;e2.y=s.player.y;g.step();const over=g.state().over;g.reset();
R['Game-over and restart states']=(over&&!g.state().over&&g.state().lives===3&&g.state().score===0)||'over='+over+' after reset over='+g.state().over;
return R`
  },
  {
    id: 'breakout', phase: 'P6', title: '4. Breakout', kind: 'web',
    brief: `Build a Breakout game in index.html + game.js on a 480x600 canvas: paddle at the bottom (arrow keys or mouse), a ball, 5 rows x 8 bricks, score, 3 lives, "You win" when all bricks are gone and "Game over" when lives run out, restart button.
Expose window.game with: state() returning the LIVE state {paddle:{x,y,w,h}, ball:{x,y,vx,vy,r}, bricks:[{x,y,w,h,alive}], lives, score, won, over, width:480, height:600}; pause(); step() advances one tick (ball moves by vx,vy; bounces off left/right/top walls by flipping vx/vy; bounces off the paddle upward; a hit brick dies, +10 score, ball vy flips; ball below the bottom loses a life and resets ball above the paddle; no bricks left → won=true; lives 0 → over=true); moveLeft(); moveRight(); reset(). ${HOOK_NOTE}`,
    items: ['Paddle movement', 'Ball physics', 'Wall collisions', 'Paddle collisions', 'Brick destruction', 'Lives and scoring', 'Win and loss conditions', 'The game behaves consistently'],
    probe: `
const g=window.game,R={};if(!g)return {'Paddle movement':'window.game missing'};g.pause();g.reset();g.pause();let s=g.state();
const px=s.paddle.x;g.moveRight();R['Paddle movement']=g.state().paddle.x>px||'paddle did not move';
s.ball.x=200;s.ball.y=400;s.ball.vx=3;s.ball.vy=-2;g.step();R['Ball physics']=(Math.abs(s.ball.x-203)<0.01&&Math.abs(s.ball.y-398)<0.01)||'ball at '+s.ball.x+','+s.ball.y;
s.ball.x=s.ball.r+1;s.ball.y=400;s.ball.vx=-4;s.ball.vy=0.0001;for(let i=0;i<3;i++)g.step();const left=s.ball.vx>0;
s.ball.x=200;s.ball.y=s.ball.r+1;s.ball.vx=0.0001;s.ball.vy=-4;for(let i=0;i<3;i++)g.step();R['Wall collisions']=(left&&s.ball.vy>0)||'left bounce='+left+' top bounce='+(s.ball.vy>0);
s.ball.x=s.paddle.x+s.paddle.w/2;s.ball.y=s.paddle.y-s.ball.r-3;s.ball.vx=0;s.ball.vy=4;for(let i=0;i<3;i++)g.step();R['Paddle collisions']=s.ball.vy<0||'ball vy after paddle '+s.ball.vy;
g.reset();g.pause();s=g.state();const br=s.bricks.filter(b=>b.alive).sort((a,b)=>b.y-a.y)[0];const sc=s.score;s.ball.x=br.x+br.w/2;s.ball.y=br.y+br.h+s.ball.r+2;s.ball.vx=0;s.ball.vy=-4;for(let i=0;i<4;i++)g.step();
R['Brick destruction']=(!br.alive&&s.ball.vy>0)||'brick alive='+br.alive;
const lv=s.lives;s.ball.x=10;s.ball.y=s.height+50;s.ball.vy=4;g.step();R['Lives and scoring']=(s.score===sc+10&&g.state().lives===lv-1)||'score '+sc+'→'+s.score+', lives '+lv+'→'+g.state().lives;
g.reset();g.pause();s=g.state();s.bricks.forEach((b,i)=>{if(i>0)b.alive=false});const last=s.bricks[0];s.ball.x=last.x+last.w/2;s.ball.y=last.y+last.h+s.ball.r+2;s.ball.vx=0;s.ball.vy=-4;for(let i=0;i<4;i++)g.step();const won=g.state().won;
g.reset();g.pause();s=g.state();s.lives=1;s.ball.y=s.height+50;s.ball.vy=4;g.step();const over=g.state().over;R['Win and loss conditions']=(won&&over)||'won='+won+' over='+over;
g.reset();g.pause();s=g.state();let bad=0;for(let i=0;i<3000;i++){g.step();const b=g.state().ball;if(!isFinite(b.x)||!isFinite(b.y)||b.x<-50||b.x>g.state().width+50)bad++;if(g.state().over||g.state().won)g.reset(),g.pause()}
R['The game behaves consistently']=bad===0||bad+' steps with the ball out of bounds or NaN';
return R`
  },
  {
    id: 'kanban', phase: 'P7', title: '5. Kanban Task Manager', kind: 'web',
    brief: `Build a Kanban task manager in index.html + app.js + style.css: three columns "To do", "Doing", "Done"; add a task (title + assignee) with a form; edit and delete tasks; drag cards between columns with HTML5 drag and drop (cards have draggable="true" and class "card", columns have class "column" and data-column set to todo|doing|done); tasks persist in localStorage under key "kanban" and survive refresh; real-time sync between open tabs/windows of the app via the window "storage" event (re-render when another tab changes the board).
Expose window.board with: tasks() → [{id,title,assignee,column}]; addTask(title, assignee, column='todo') → id; editTask(id, {title?, assignee?}); deleteTask(id); moveTask(id, column); assign(id, person). ${HOOK_NOTE}`,
    items: ['A task management application', 'Task creation', 'Task deletion', 'Task editing', 'Draggable task cards', 'Multiple task columns', 'Task assignments', 'Persistent storage', 'Real-time collaboration', 'Multiple users see the same task updates', "Refreshing doesn't lose tasks"],
    probe: `
const b=window.board,R={};if(!b)return {'A task management application':'window.board missing'};localStorage.removeItem('kanban');
const cols=document.querySelectorAll('.column');R['Multiple task columns']=cols.length>=3||cols.length+' columns';
const id=b.addTask('Write tests','Ana');R['Task creation']=(b.tasks().some(t=>t.id===id&&t.title==='Write tests')&&document.body.innerText.includes('Write tests'))||'task not created or not shown';
R['A task management application']=R['Task creation']===true&&R['Multiple task columns']===true||'see creation/columns';
b.editTask(id,{title:'Write more tests'});R['Task editing']=(b.tasks().find(t=>t.id===id).title==='Write more tests'&&document.body.innerText.includes('Write more tests'))||'edit not applied';
b.assign(id,'Ben');R['Task assignments']=(b.tasks().find(t=>t.id===id).assignee==='Ben'&&document.body.innerText.includes('Ben'))||'assign not applied';
await new Promise(r=>setTimeout(r,200));const card=[...document.querySelectorAll('.card')].find(c=>c.textContent.includes('Write more tests'));const done=document.querySelector('.column[data-column="done"]');
if(card&&done&&card.draggable){const dt=new DataTransfer();card.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:dt}));done.dispatchEvent(new DragEvent('dragenter',{bubbles:true,dataTransfer:dt}));done.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:dt}));done.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt}));card.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:dt}))}
await new Promise(r=>setTimeout(r,200));R['Draggable task cards']=b.tasks().find(t=>t.id===id).column==='done'||(card?(card.draggable?'drop on Done did not move the card':'card is not draggable'):'card element not found');
R['Persistent storage']=(localStorage.getItem('kanban')||'').includes('Write more tests')||'not saved to localStorage';
const fr=document.createElement('iframe');fr.src=location.href;fr.style.cssText='width:600px;height:400px';document.body.appendChild(fr);await new Promise(r=>fr.onload=r);await new Promise(r=>setTimeout(r,500));
const other=fr.contentWindow.board;R["Refreshing doesn't lose tasks"]=(other&&other.tasks().some(t=>t.title==='Write more tests'))||'a freshly loaded copy does not have the task';
const id2=b.addTask('From tab one','Cy');await new Promise(r=>setTimeout(r,800));
R['Real-time collaboration']=(other&&other.tasks().some(t=>t.id===id2)&&fr.contentDocument.body.innerText.includes('From tab one'))||'second window did not update live';
other&&other.moveTask(id2,'doing');await new Promise(r=>setTimeout(r,800));R['Multiple users see the same task updates']=(b.tasks().find(t=>t.id===id2)||{}).column==='doing'||'change made in the other window not seen';
b.deleteTask(id2);await new Promise(r=>setTimeout(r,500));R['Task deletion']=(!b.tasks().some(t=>t.id===id2)&&!document.body.innerText.includes('From tab one'))||'task still there';
return R`
  },
  {
    id: 'pathfinding', phase: 'P7', title: '6. Pathfinding Visualizer', kind: 'web',
    brief: `Build a pathfinding visualizer in index.html + app.js + style.css: a grid of 20 rows x 30 cols (div cells with class "cell"); click to toggle walls, buttons or a mode to place start and end, buttons to run A*, Dijkstra and BFS with an animated search (visited cells get class "visited" over time, final path cells get class "path"), a results panel comparing visited count and time for each algorithm, and a "No path" message when the end is unreachable. Moves are 4-directional, all steps cost 1.
Expose window.pf with: reset(rows, cols); setWall(r,c,on=true); setStart(r,c); setEnd(r,c); run(alg, {animate:false}) where alg is 'astar'|'dijkstra'|'bfs', returning {path:[[r,c],...] including start and end or [] if unreachable, visited:number, ms:number}; compare() → {astar:{visited,ms,length}, dijkstra:{...}, bfs:{...}}. ${HOOK_NOTE}`,
    items: ['An interactive grid', 'Users can place walls and obstacles', 'Users can select a start point and destination', 'A* pathfinding', "Dijkstra's algorithm", 'Breadth-First Search', 'Animated search process', 'Displays the resulting path', "Compares the algorithms' performance", 'Handles unreachable destinations', 'Each algorithm returns correct results'],
    probe: `
const p=window.pf,R={};if(!p)return {'An interactive grid':'window.pf missing'};
R['An interactive grid']=document.querySelectorAll('.cell').length>=600||document.querySelectorAll('.cell').length+' cells';
const before=document.querySelectorAll('.cell.wall, .cell[class*="wall"]').length;const c=document.querySelectorAll('.cell')[45];c&&c.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));c&&c.click();c&&c.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
R['Users can place walls and obstacles']=document.querySelectorAll('.cell.wall, .cell[class*="wall"]').length!==before||'clicking a cell did not toggle a wall';
const N=12,M=12;const walls=new Set();for(let r=0;r<N;r++)for(let k=0;k<M;k++){if((r*7+k*13)%5===0&&!(r===0&&k===0)&&!(r===N-1&&k===M-1))walls.add(r+','+k)}
p.reset(N,M);walls.forEach(w=>{const [r,k]=w.split(',').map(Number);p.setWall(r,k,true)});p.setStart(0,0);p.setEnd(N-1,M-1);
R['Users can select a start point and destination']=!!document.querySelector('.cell.start, .cell[class*="start"]')&&!!document.querySelector('.cell.end, .cell[class*="end"], .cell[class*="target"], .cell[class*="goal"]')||'start/end cells not marked';
const bfs=()=>{const q=[[0,0]],d={'0,0':0};while(q.length){const [r,k]=q.shift();for(const [dr,dk] of [[1,0],[-1,0],[0,1],[0,-1]]){const nr=r+dr,nk=k+dk,key=nr+','+nk;if(nr<0||nk<0||nr>=N||nk>=M||walls.has(key)||key in d)continue;d[key]=d[r+','+k]+1;q.push([nr,nk])}}return d[(N-1)+','+(M-1)]};
const best=bfs();const valid=(path)=>{if(!path.length)return false;for(let i=1;i<path.length;i++){const [a,b]=path[i-1],[c2,d]=path[i];if(Math.abs(a-c2)+Math.abs(b-d)!==1||walls.has(c2+','+d))return false}return path[0]+''==='0,0'&&path[path.length-1]+''===(N-1)+','+(M-1)};
const res={};for(const [alg,name] of [['astar','A* pathfinding'],['dijkstra',"Dijkstra's algorithm"],['bfs','Breadth-First Search']]){const r=p.run(alg,{animate:false});res[alg]=r;R[name]=(valid(r.path)&&r.path.length-1===best)||'path length '+(r.path.length-1)+' vs shortest '+best+(valid(r.path)?'':' (invalid path)')}
R['Each algorithm returns correct results']=['A* pathfinding',"Dijkstra's algorithm",'Breadth-First Search'].every(k=>R[k]===true)||'see the three algorithm rows';
R['Displays the resulting path']=document.querySelectorAll('.cell.path, .cell[class*="path"]').length>=best||'path cells not highlighted';
const cmp=p.compare();R["Compares the algorithms' performance"]=(cmp&&['astar','dijkstra','bfs'].every(a=>cmp[a]&&typeof cmp[a].visited==='number')&&/a\\*|astar/i.test(document.body.innerText)&&/dijkstra/i.test(document.body.innerText))||'no comparison data/panel';
p.reset(N,M);for(let k=0;k<M;k++)p.setWall(5,k,true);p.setStart(0,0);p.setEnd(N-1,M-1);const u=p.run('astar',{animate:false});
R['Handles unreachable destinations']=(u.path.length===0&&/no path|unreachable|not reachable|no route/i.test(document.body.innerText))||'path='+u.path.length+' message shown='+/no path|unreachable/i.test(document.body.innerText);
p.reset(N,M);p.setStart(0,0);p.setEnd(N-1,M-1);const runP=p.run('bfs',{animate:true});await new Promise(r=>setTimeout(r,60));const mid=document.querySelectorAll('.cell.visited, .cell[class*="visited"]').length;await new Promise(r=>setTimeout(r,4000));const end=document.querySelectorAll('.cell.visited, .cell[class*="visited"]').length;
R['Animated search process']=(end>mid&&end>10)||'visited cells did not appear over time ('+mid+'→'+end+')';
return R`
  },
  {
    id: 'world', phase: 'P7', title: '7. Procedural World Generator', kind: 'web',
    brief: `Build a procedural world generator in index.html + world.js: a 128x128 tile map drawn on a canvas, generated from 2D Perlin or Simplex noise you implement yourself (with octaves) and a numeric seed (seeded PRNG, no Math.random in generation). Terrain: deep water/lakes, rivers (carved downhill from high points), beaches, grass, forests (a second noise layer), mountains and snow on peaks. A seed input + "Generate" and "Random seed" buttons, and a player square moved with arrow keys/WASD that can't walk into water or mountains.
Expose window.world with: generate(seed) (synchronous); tile(x,y) → 'water'|'river'|'sand'|'grass'|'forest'|'mountain'|'snow'; height(x,y) → 0..1; size:128; seed; player:{x,y}; move(dx,dy) → true if moved; regenerate() picks a new random seed and generates. ${HOOK_NOTE}`,
    items: ['A random terrain map', 'Perlin or Simplex noise', 'Mountains', 'Lakes and rivers', 'Forests', 'World seeds', 'Identical seeds produce identical worlds', 'Users can regenerate worlds', 'A controllable character', 'Terrain generation performs efficiently'],
    probe: `
const W=window.world,R={};if(!W)return {'A random terrain map':'window.world missing'};
const t0=performance.now();W.generate(1234);const ms=performance.now()-t0;
const counts={};const sig=()=>{let s='';for(let y=0;y<W.size;y+=3)for(let x=0;x<W.size;x+=3)s+=W.tile(x,y)[0];return s};
for(let y=0;y<W.size;y++)for(let x=0;x<W.size;x++){const t=W.tile(x,y);counts[t]=(counts[t]||0)+1}
R['A random terrain map']=(Object.keys(counts).length>=4&&!!document.querySelector('canvas'))||JSON.stringify(counts);
R['Mountains']=(counts.mountain||0)+(counts.snow||0)>20||'mountain tiles: '+((counts.mountain||0)+(counts.snow||0));
R['Lakes and rivers']=((counts.water||0)>50&&(counts.river||0)>10)||'water '+(counts.water||0)+', river '+(counts.river||0);
R['Forests']=(counts.forest||0)>50||'forest tiles: '+(counts.forest||0);
let diff=0,n=0;for(let y=1;y<W.size;y+=2)for(let x=1;x<W.size;x+=2){diff+=Math.abs(W.height(x,y)-W.height(x-1,y));n++}const smooth=diff/n;
let spread=0;const hs=[];for(let i=0;i<400;i++)hs.push(W.height((i*37)%W.size,(i*91)%W.size));spread=Math.max(...hs)-Math.min(...hs);
R['Perlin or Simplex noise']=(smooth<0.05&&spread>0.4)||'neighbour difference '+smooth.toFixed(3)+', range '+spread.toFixed(2)+' (noise should be smooth but varied)';
const a=sig();W.generate(1234);const b=sig();W.generate(999);const c=sig();
R['Identical seeds produce identical worlds']=a===b||'same seed gave a different map';R['World seeds']=(a!==c&&W.seed===999)||'different seeds give the same map or seed not stored';
const s0=W.seed,m0=sig();W.regenerate();R['Users can regenerate worlds']=(W.seed!==s0&&sig()!==m0)||'regenerate did not change the world';
W.generate(1234);let moved=false;for(const [dx,dy] of [[1,0],[0,1],[-1,0],[0,-1]]){const p0={...W.player};if(W.move(dx,dy)){moved=W.player.x!==p0.x||W.player.y!==p0.y;break}}
let blocked='not tested';outer:for(let y=1;y<W.size-1;y++)for(let x=1;x<W.size-1;x++){if(W.tile(x,y)==='water'&&!['water','river','mountain','snow'].includes(W.tile(x-1,y))){W.player.x=x-1;W.player.y=y;blocked=W.move(1,0)===false&&W.player.x===x-1;break outer}}
R['A controllable character']=(moved&&blocked===true)||'moved='+moved+' blocked by water='+blocked;
R['Terrain generation performs efficiently']=ms<500||'generate(128x128) took '+ms.toFixed(0)+' ms';
return R`
  },
  {
    id: 'chat', phase: 'P7', title: '8. Real-Time Chat Application', kind: 'server',
    brief: `Build a real-time chat app with a Node.js server using ONLY built-in modules (node:http, node:fs, node:crypto — no npm packages) in server.js, plus public/index.html + public/client.js.
Server API (JSON): GET / serves public/index.html (and other files in public/); GET /events?user=NAME&room=ROOM is a Server-Sent Events stream sending lines "data: <json>\\n\\n" for events {type:'message', message} | {type:'typing', user, room} | {type:'presence', room, online:[names]} — presence is sent when anyone joins or leaves (a closed SSE connection counts as leaving); POST /send body {user, room, text} → returns the stored message {id, user, room, text, ts} (ts = Date.now(), id unique) and broadcasts it ONLY to clients in that room; POST /typing body {user, room} broadcasts a typing event to the room; GET /history?room=ROOM → array of that room's messages in order; GET /online?room=ROOM → array of names. Messages persist to data/messages.json and are reloaded on restart. Private rooms: a room name is just a string; clients only receive their room's events.
The page asks for a name and room, shows messages with timestamps, who is online, "X is typing…", and has a send box. The server listens on process.env.PORT or 3000. Add a hive.json with {"command":"node server.js","port":3000}. ${HOOK_NOTE}`,
    items: ['A chat interface', 'Multiple users', 'Sending and receiving messages', 'Persistent message history', 'Timestamps', 'Online indicators', 'Typing indicators', 'Private chat rooms', 'Handles simultaneous messages', 'Handles disconnected users', 'Messages aren\'t lost or duplicated']
  },
  {
    id: 'voxel', phase: 'P8', title: '9. Minecraft-Style Voxel Engine', kind: 'web',
    brief: `Build a Minecraft-style voxel engine in index.html + engine.js using Three.js loaded as an ES module from https://unpkg.com/three@0.160.0/build/three.module.js. 16x16x64 chunks generated from seeded 2D noise (grass/dirt/stone layers), only faces next to air are meshed (one merged BufferGeometry per chunk), chunks within radius 3 of the player are loaded and farther ones are unloaded (geometry disposed). First-person controls (WASD + mouse look via pointer lock, Space to jump, gravity), AABB collision with blocks, left click destroys and right click places a block (raycast). World edits persist in localStorage ("voxel-edits") and are re-applied when chunks load. Show FPS and loaded chunk count.
Expose window.engine with: getBlock(x,y,z) → 0 for air or a block id; setBlock(x,y,z,id) (updates the chunk mesh); loadedChunks() → ['cx,cz',...]; chunkSize:16; player:{position:{x,y,z}, velocity:{x,y,z}}; teleport(x,y,z); update(dt) runs physics + chunk loading once (works even when the tab is hidden); save(); load(); stats() → {fps, chunks, triangles}. ${HOOK_NOTE}`,
    items: ['A 3D environment', 'A voxel-based world', 'Block rendering', 'Procedural terrain generation', 'Chunk generation', 'Chunk loading and unloading', 'Player movement', 'Collision detection', 'Block placement', 'Block destruction', 'World persistence', 'Optimized rendering and chunk management', 'Stays playable as the world grows'],
    probe: `
for(let i=0;i<50&&!window.engine;i++)await new Promise(r=>setTimeout(r,200));const E=window.engine,R={};if(!E)return {'A 3D environment':'window.engine missing (Three.js may have failed to load)'};
const cv=document.querySelector('canvas');let gl=null;try{gl=cv&&(cv.getContext('webgl2')||cv.getContext('webgl'))}catch(e){}R['A 3D environment']=!!(cv&&(gl||cv.width>0))||'no WebGL canvas';
for(let i=0;i<10;i++)E.update(0.05);let solid=0,air=0;const hs=[];for(let x=0;x<32;x+=2)for(let z=0;z<32;z+=2){let top=-1;for(let y=63;y>=0;y--){if(E.getBlock(x,y,z)){top=y;break}}hs.push(top);for(let y=0;y<64;y+=4)E.getBlock(x,y,z)?solid++:air++}
R['A voxel-based world']=(solid>0&&air>0)||'solid '+solid+' air '+air;R['Procedural terrain generation']=(new Set(hs).size>=3)||'terrain is flat: heights '+[...new Set(hs)].join(',');
const st=E.stats();R['Block rendering']=st.triangles>0||'0 triangles';
const ch0=E.loadedChunks();R['Chunk generation']=ch0.length>=9||ch0.length+' chunks';
E.teleport(16*20+8,60,16*20+8);for(let i=0;i<20;i++)E.update(0.05);const ch1=E.loadedChunks();
R['Chunk loading and unloading']=(ch1.includes('20,20')&&!ch1.includes('0,0'))||'after moving 20 chunks: loaded '+ch1.length+', has 20,20='+ch1.includes('20,20')+', still has 0,0='+ch1.includes('0,0');
const P=E.player.position;const x0=P.x,z0=P.z;const sp=0;window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyW',key:'w'}));document.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyW',key:'w'}));for(let i=0;i<20;i++)E.update(0.05);window.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyW',key:'w'}));document.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyW',key:'w'}));
R['Player movement']=Math.hypot(P.x-x0,P.z-z0)>0.5||'W key moved the player '+Math.hypot(P.x-x0,P.z-z0).toFixed(2);
let gy=-1;for(let y=63;y>=0;y--){if(E.getBlock(Math.floor(P.x),y,Math.floor(P.z))){gy=y;break}}for(let i=0;i<100;i++)E.update(0.05);
R['Collision detection']=(P.y>=gy+0.9&&P.y<gy+3)||'player y '+P.y.toFixed(2)+' vs ground '+gy;
const bx=Math.floor(P.x)+2,bz=Math.floor(P.z);let by=63;while(by>0&&!E.getBlock(bx,by,bz))by--;E.setBlock(bx,by+1,bz,1);R['Block placement']=E.getBlock(bx,by+1,bz)!==0||'block not placed';
E.setBlock(bx,by,bz,0);R['Block destruction']=E.getBlock(bx,by,bz)===0||'block not removed';
E.save();localStorage.getItem('voxel-edits');const fr=document.createElement('iframe');fr.src=location.href;fr.style.cssText='width:320px;height:240px';document.body.appendChild(fr);await new Promise(r=>fr.onload=r);
for(let i=0;i<50&&!fr.contentWindow.engine;i++)await new Promise(r=>setTimeout(r,200));const E2=fr.contentWindow.engine;
if(E2){E2.teleport(bx,by+5,bz);for(let i=0;i<10;i++)E2.update(0.05);E2.load&&E2.load()}R['World persistence']=(E2&&E2.getBlock(bx,by+1,bz)!==0&&E2.getBlock(bx,by,bz)===0)||'edits missing after reload';
const tri=E.stats().triangles,chunks=E.loadedChunks().length;R['Optimized rendering and chunk management']=(tri/Math.max(1,chunks)<60000&&chunks<=60)||tri+' triangles for '+chunks+' chunks (faces between solid blocks are probably not culled)';
let frames=0;const tEnd=performance.now()+2000;const tick=()=>{frames++;if(performance.now()<tEnd)requestAnimationFrame(tick)};requestAnimationFrame(tick);
for(let i=0;i<30;i++){E.teleport(16*(20+i)+8,60,8);E.update(0.05)}await new Promise(r=>setTimeout(r,2100));const fps=frames/2;
R['Stays playable as the world grows']=(E.loadedChunks().length<=60&&fps>=20)||'after flying 30 chunks: '+E.loadedChunks().length+' chunks loaded, '+fps+' fps';
return R`
  },
  {
    id: 'physics', phase: 'P8', title: '10. Physics Simulator', kind: 'web',
    brief: `Build an interactive 2D physics simulator in index.html + physics.js on a canvas (800x500 box with walls): circles with mass, gravity, elastic and inelastic collisions between circles and with walls (restitution parameter), friction against the floor, a particle emitter (small short-lived particles), click on the canvas to add a ball, sliders for gravity, restitution and friction, a "Spawn 300" button, and an FPS / step-time readout.
Expose window.sim with: bodies (the LIVE array of {x,y,vx,vy,r,m}); add({x,y,vx,vy,r,m}) → body; clear(); step(dt) advances physics once (no drawing required); params:{gravity (px/s²), restitution (0..1), friction (0..1)} that step() reads; emit(x,y,n) creates particles; particles (array); pause() stops the automatic loop. Use a fixed dt and resolve circle-circle collisions with impulse along the normal so momentum is conserved. ${HOOK_NOTE}`,
    items: ['An interactive physics simulation', 'Gravity', 'Elastic collisions', 'Friction', 'Particle systems', 'Users can create objects', 'Users can modify simulation parameters', 'Interactions between hundreds of objects', 'Conservation of momentum in appropriate collisions', 'Numerical stability', 'Measured simulation performance'],
    probe: `
const S=window.sim,R={};if(!S)return {'An interactive physics simulation':'window.sim missing'};S.pause&&S.pause();
R['An interactive physics simulation']=!!document.querySelector('canvas')||'no canvas';
S.clear();S.params.gravity=500;S.params.friction=0;S.params.restitution=1;const b=S.add({x:400,y:100,vx:0,vy:0,r:10,m:1});for(let i=0;i<10;i++)S.step(0.01);
R['Gravity']=(Math.abs(b.vy-50)<5&&b.y>100)||'after 0.1 s at g=500: vy='+b.vy.toFixed(2)+' (expected ~50)';
S.clear();S.params.gravity=0;S.params.friction=0;S.params.restitution=1;const p1=S.add({x:300,y:250,vx:100,vy:0,r:10,m:1}),p2=S.add({x:360,y:250,vx:-50,vy:0,r:10,m:3});
const mom0=p1.m*p1.vx+p2.m*p2.vx,ke0=0.5*p1.m*p1.vx**2+0.5*p2.m*p2.vx**2;for(let i=0;i<60;i++)S.step(0.01);
const mom1=p1.m*p1.vx+p2.m*p2.vx,ke1=0.5*p1.m*(p1.vx**2+p1.vy**2)+0.5*p2.m*(p2.vx**2+p2.vy**2);const collided=p1.vx<0||p2.vx>0;
R['Conservation of momentum in appropriate collisions']=(collided&&Math.abs(mom1-mom0)<0.01*Math.abs(mom0)+0.5)||'collided='+collided+' momentum '+mom0.toFixed(1)+'→'+mom1.toFixed(1);
R['Elastic collisions']=(collided&&Math.abs(ke1-ke0)/ke0<0.02)||'collided='+collided+' kinetic energy '+ke0.toFixed(0)+'→'+ke1.toFixed(0);
S.clear();S.params.gravity=500;S.params.friction=0.5;S.params.restitution=0;const f=S.add({x:100,y:480,vx:200,vy:0,r:10,m:1});for(let i=0;i<100;i++)S.step(0.01);
R['Friction']=(f.vx>=0&&f.vx<150)||'sliding ball vx after 1 s with friction 0.5: '+f.vx.toFixed(1);
const n0=(S.particles||[]).length;S.emit(400,250,50);R['Particle systems']=(S.particles.length>=n0+50)||'particles '+n0+'→'+S.particles.length;
for(let i=0;i<300;i++)S.step(0.01);R['Particle systems']=R['Particle systems']===true&&S.particles.length<n0+50?true:(R['Particle systems']===true?'particles never expire':R['Particle systems']);
S.clear();const cv=document.querySelector('canvas');const rc=cv.getBoundingClientRect();for(const t of ['mousedown','mouseup','click','pointerdown','pointerup']){cv.dispatchEvent(new MouseEvent(t,{bubbles:true,clientX:rc.left+200,clientY:rc.top+150}))}
R['Users can create objects']=S.bodies.length>=1||'clicking the canvas added no ball';
const sl=[...document.querySelectorAll('input[type=range]')];let changed=false;for(const s of sl){const old=JSON.stringify(S.params);s.value=String(Number(s.max||1)*0.73);s.dispatchEvent(new Event('input',{bubbles:true}));s.dispatchEvent(new Event('change',{bubbles:true}));if(JSON.stringify(S.params)!==old)changed=true}
R['Users can modify simulation parameters']=(sl.length>=3&&changed)||sl.length+' sliders; params changed='+changed;
S.clear();S.params.gravity=300;S.params.restitution=0.9;S.params.friction=0.1;for(let i=0;i<300;i++)S.add({x:20+(i%30)*25,y:20+Math.floor(i/30)*25,vx:(i*37%100)-50,vy:0,r:6,m:1});
let t=performance.now();for(let i=0;i<200;i++)S.step(1/60);const per=(performance.now()-t)/200;
const overlap=()=>{let o=0;const B=S.bodies;for(let i=0;i<B.length;i++)for(let j=i+1;j<B.length;j++){const d=Math.hypot(B[i].x-B[j].x,B[i].y-B[j].y);if(d<(B[i].r+B[j].r)*0.5)o++}return o};
R['Interactions between hundreds of objects']=(S.bodies.length===300&&overlap()<15)||S.bodies.length+' bodies, '+overlap()+' deep overlaps (collisions not resolved)';
R['Measured simulation performance']=(per<16&&/fps|ms/i.test(document.body.innerText))||per.toFixed(2)+' ms per step with 300 bodies; readout shown='+/fps|ms/i.test(document.body.innerText);
S.clear();S.params.gravity=0;S.params.friction=0;S.params.restitution=1;for(let i=0;i<40;i++)S.add({x:50+(i%8)*90,y:60+Math.floor(i/8)*90,vx:(i*53%300)-150,vy:(i*71%300)-150,r:8,m:1+(i%3)});
const E=()=>S.bodies.reduce((s,q)=>s+0.5*q.m*(q.vx**2+q.vy**2),0);const e0=E();for(let i=0;i<3000;i++)S.step(1/120);const e1=E();const nan=S.bodies.some(q=>!isFinite(q.x)||!isFinite(q.vx));const inside=S.bodies.every(q=>q.x>-5&&q.x<805&&q.y>-5&&q.y<505);
R['Numerical stability']=(!nan&&inside&&e1<e0*1.1)||'NaN='+nan+' escaped box='+!inside+' energy '+e0.toFixed(0)+'→'+e1.toFixed(0);
return R`
  },
  {
    id: 'chess', phase: 'P8', title: '11. Chess Engine', kind: 'web',
    brief: `Build a chess game with an engine in index.html + chess.js + ui.js: an 8x8 clickable board with Unicode pieces, full legal move generation (check, castling both sides with all rules, en passant, promotion to any piece), check/checkmate/stalemate detection, FEN load/export, material+piece-square evaluation, minimax search with alpha-beta pruning, and a computer opponent that plays Black.
Expose window.chess with: load(fen); fen(); moves() → legal moves in UCI like 'e2e4','e7e8q'; move(uci) → true if legal and played, false otherwise; turn() → 'w'|'b'; inCheck(); isCheckmate(); isStalemate(); evaluate() → centipawns from White's view; perft(depth) → number of leaf nodes; search(depth, {alphaBeta:true|false}) → {move, score, nodes}; bestMove(depth) → uci. ${HOOK_NOTE}`,
    items: ['A functional chessboard', 'Legal move generation', 'Piece movement', 'Check detection', 'Checkmate detection', 'Stalemate detection', 'Castling', 'En passant', 'Pawn promotion', 'Board evaluation', 'Minimax', 'Alpha-beta pruning', 'A playable computer opponent', 'Tested against known chess positions', 'Illegal moves are never accepted'],
    probe: `
const C=window.chess,R={};if(!C)return {'A functional chessboard':'window.chess missing'};const START='rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const sq=document.querySelectorAll('[data-square], .square, td.cell, .cell');R['A functional chessboard']=(sq.length>=64&&/[♔♕♖♗♘♙♚♛♜♝♞♟]/.test(document.body.innerText))||sq.length+' squares, pieces shown='+/[♔♚]/.test(document.body.innerText);
C.load(START);R['Legal move generation']=C.moves().length===20||C.moves().length+' moves from the start (expected 20)';
const ok=C.move('e2e4');R['Piece movement']=(ok&&C.fen().split(' ')[0]==='rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR'&&C.turn()==='b')||'after e2e4: '+C.fen();
C.load(START);R['Illegal moves are never accepted']=(C.move('e2e5')===false&&C.move('g1g3')===false&&C.fen()===START.replace(/ 0 1$/,' 0 1'))||'an illegal move changed the board';
C.load('4k3/8/8/8/8/8/4r3/4K3 w - - 0 1');const intoCheck=C.move('e1f2')||false;C.load('4k3/8/8/8/8/8/3r4/4K3 w - - 0 1');const stayCheck=C.moves().includes('e1e2')||C.moves().includes('e1d1');
C.load('4k3/8/8/8/8/8/4q3/4K3 w - - 0 1');R['Check detection']=C.inCheck()===true||'king attacked by a queen not detected';
R['Illegal moves are never accepted']=R['Illegal moves are never accepted']===true&&!intoCheck&&!stayCheck?true:(R['Illegal moves are never accepted']===true?'allowed a king move into check':R['Illegal moves are never accepted']);
C.load(START);['f2f3','e7e5','g2g4','d8h4'].forEach(m=>C.move(m));R['Checkmate detection']=C.isCheckmate()===true||"fool's mate not detected";
C.load('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');R['Stalemate detection']=(C.isStalemate()===true&&!C.isCheckmate())||'stalemate not detected';
C.load('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');const cm=C.moves();const c1=cm.includes('e1g1')&&cm.includes('e1c1');C.move('e1g1');const after=C.fen().split(' ')[0];
C.load('r3k2r/8/8/8/8/8/5r2/R3K2R w KQkq - 0 1');const through=C.moves().includes('e1g1');R['Castling']=(c1&&after.endsWith('R4RK1')&&!through)||'castle moves '+c1+', board after O-O '+after+', castles through attacked square='+through;
C.load('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1');const ep=C.moves().includes('e5d6');C.move('e5d6');R['En passant']=(ep&&C.fen().split(' ')[0]==='4k3/8/3P4/8/8/8/8/4K3')||'ep available='+ep+' board '+C.fen().split(' ')[0];
C.load('4k3/P7/8/8/8/8/8/4K3 w - - 0 1');const pm=C.moves();const promos=['a7a8q','a7a8r','a7a8b','a7a8n'].every(m=>pm.includes(m));C.move('a7a8q');R['Pawn promotion']=(promos&&C.fen().startsWith('Q3k3'))||'promotion moves '+promos+' board '+C.fen().split(' ')[0];
C.load('4k3/8/8/8/8/8/8/3QK3 w - - 0 1');const up=C.evaluate();C.load('3qk3/8/8/8/8/8/8/4K3 w - - 0 1');const down=C.evaluate();R['Board evaluation']=(up>500&&down<-500)||'queen up '+up+', queen down '+down;
const pf=[];C.load(START);pf.push(C.perft(1)===20,C.perft(2)===400,C.perft(3)===8902);C.load('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1');const kp1=C.perft(1),kp2=C.perft(2);pf.push(kp1===48,kp2===2039);
R['Tested against known chess positions']=pf.every(Boolean)||'perft start d1-3 '+pf.slice(0,3)+'; Kiwipete d1='+kp1+' (48) d2='+kp2+' (2039)';
C.load('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1');const mm=C.search(3,{alphaBeta:false});C.load('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1');const ab=C.search(3,{alphaBeta:true});
R['Minimax']=(mm.move==='a1a8')||'minimax depth 3 chose '+mm.move+' instead of mate in 1 (a1a8)';R['Alpha-beta pruning']=(ab.move==='a1a8'&&ab.nodes<mm.nodes)||'alpha-beta chose '+ab.move+', nodes '+ab.nodes+' vs minimax '+mm.nodes;
C.load(START);C.move('e2e4');const t=performance.now();const bm=C.bestMove(3);const ms=performance.now()-t;const legal=C.moves().includes(bm);R['A playable computer opponent']=(legal&&ms<15000)||'reply '+bm+' legal='+legal+' in '+ms.toFixed(0)+' ms';
return R`
  },
  {
    id: 'visual', phase: 'P8', title: '12. Visual Programming Environment', kind: 'web',
    brief: `Build a node-based visual programming environment in index.html + app.js + style.css: a canvas area where nodes are absolutely-positioned divs (class "node") you can drag with the mouse, each with input ports (class "port in") and output ports (class "port out"); drag from an output to an input to connect them, drawn as SVG paths (class "wire") that follow the nodes. Node types: "number" (editable value, 1 output), "add", "subtract", "multiply", "divide" (2 inputs a,b, 1 output), "output" (1 input, displays its value). A Run button evaluates the graph in dependency order (topological sort); cycles are rejected with a visible error; missing inputs or division by zero show an error on that node instead of crashing. Save/Load buttons store the graph as JSON in localStorage. On first load show an example program computing (2 + 3) * 4.
Expose window.vp with: addNode(type, x, y, value?) → id; connect(fromId, toId, inputName) → true, or false if it would create a cycle or the port is taken; run() → {values:{id:number}, errors:{id:message}}; nodes() → [{id,type,x,y,value}]; edges() → [{from,to,input}]; save() → json string; load(json); clear(). ${HOOK_NOTE}`,
    items: ['Draggable programming nodes', 'Node connections', 'Input and output ports', 'A node execution system', 'Dependency resolution', 'Detects circular dependencies', 'Error handling', 'Graph visualization', 'Saving and loading', 'A working example program built with the node system'],
    probe: `
const V=window.vp,R={};if(!V)return {'Draggable programming nodes':'window.vp missing'};
const ex=V.run();const exOut=V.nodes().filter(n=>n.type==='output').map(n=>ex.values[n.id]);R['A working example program built with the node system']=exOut.includes(20)||'example outputs: '+JSON.stringify(exOut);
V.clear();const id=V.addNode('number',100,100,5);await new Promise(r=>setTimeout(r,100));const el=[...document.querySelectorAll('.node')].pop();const r0=el.getBoundingClientRect();
const fire=(t,x,y,target=el)=>target.dispatchEvent(new MouseEvent(t,{bubbles:true,clientX:x,clientY:y,buttons:1}))||target.dispatchEvent(new PointerEvent(t.replace('mouse','pointer'),{bubbles:true,clientX:x,clientY:y,buttons:1}));
const grab=el.querySelector('.title, .header, .node-title, .node-header')||el;fire('mousedown',r0.left+10,r0.top+8,grab);fire('pointerdown',r0.left+10,r0.top+8,grab);for(let i=1;i<=5;i++){fire('mousemove',r0.left+10+i*30,r0.top+8+i*20,document);fire('pointermove',r0.left+10+i*30,r0.top+8+i*20,document)}fire('mouseup',r0.left+160,r0.top+108,document);fire('pointerup',r0.left+160,r0.top+108,document);
const r1=el.getBoundingClientRect();R['Draggable programming nodes']=(Math.abs(r1.left-r0.left)>50)||'node moved '+(r1.left-r0.left).toFixed(0)+'px';
R['Input and output ports']=(el.querySelectorAll('.port.out').length>=1&&!!document.querySelector('.port.in'))||(V.addNode('add',300,100),document.querySelector('.port.in')?true:'no input/output port elements');
V.clear();const a=V.addNode('number',50,50,2),b=V.addNode('number',50,150,3),s=V.addNode('add',250,100),m=V.addNode('multiply',450,100),f=V.addNode('number',250,250,4),o=V.addNode('output',650,100);
const ok=[V.connect(a,s,'a'),V.connect(b,s,'b'),V.connect(s,m,'a'),V.connect(f,m,'b'),V.connect(m,o,'in')];await new Promise(r=>setTimeout(r,100));
R['Node connections']=(ok.every(Boolean)&&V.edges().length===5)||'connect results '+ok+', edges '+V.edges().length;
R['Graph visualization']=document.querySelectorAll('.wire, svg path').length>=5||document.querySelectorAll('.wire, svg path').length+' wires drawn';
const res=V.run();R['A node execution system']=res.values[o]===20||'output '+res.values[o]+' (expected 20)';
V.clear();const o2=V.addNode('output',600,100),m2=V.addNode('multiply',400,100),s2=V.addNode('add',200,100),n1=V.addNode('number',0,50,1),n2=V.addNode('number',0,150,6),n3=V.addNode('number',200,250,7);
V.connect(m2,o2,'in');V.connect(s2,m2,'a');V.connect(n3,m2,'b');V.connect(n1,s2,'a');V.connect(n2,s2,'b');R['Dependency resolution']=V.run().values[o2]===49||'nodes created in reverse order gave '+V.run().values[o2];
const s3=V.addNode('add',300,300);V.connect(m2,s3,'a');const cyc=V.connect(s3,s2,'a');const cycRun=V.run();
R['Detects circular dependencies']=(cyc===false||Object.keys(cycRun.errors||{}).length>0&&/cycle|circular|loop/i.test(JSON.stringify(cycRun.errors)+document.body.innerText))||'cycle accepted silently';
V.clear();const d1=V.addNode('number',0,0,1),d0=V.addNode('number',0,100,0),dv=V.addNode('divide',200,50),lone=V.addNode('add',200,200),oo=V.addNode('output',400,50);V.connect(d1,dv,'a');V.connect(d0,dv,'b');V.connect(dv,oo,'in');let threw=false,er;try{er=V.run()}catch(e){threw=true}
R['Error handling']=(!threw&&er&&Object.keys(er.errors||{}).length>=1)||(threw?'run() threw':'no error reported for divide-by-zero / missing inputs');
V.clear();const x1=V.addNode('number',0,0,10),x2=V.addNode('output',200,0);V.connect(x1,x2,'in');const js=V.save();V.clear();V.load(js);const back=V.run();
R['Saving and loading']=(V.nodes().length===2&&Object.values(back.values).includes(10))||'after save/clear/load: '+V.nodes().length+' nodes';
return R`
  }
]
