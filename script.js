let tasks = [];
let renderer = null;
let currentAlg = 'RM';

const taskColors = [
    '#00f2fe', // T1 (Cyan/Blue)
    '#e11d48', // T2 (Pink/Red)
    '#10b981', // T3 (Green)
    '#f59e0b', // Amber
    '#8b5cf6', // Purple
    '#ec4899'  // Pink
];

document.addEventListener('DOMContentLoaded', () => {
    renderer = new TimelineRenderer();
    updateUI();
});

function setAlgorithm(alg) {
    currentAlg = alg;
    document.getElementById('btnRM').classList.remove('active');
    document.getElementById('btnEDF').classList.remove('active');
    document.getElementById('btn' + alg).classList.add('active');
}

function addTask() {
    if (renderer) renderer.stop();
    const nInp = document.getElementById('taskName'), cInp = document.getElementById('execTime'), pInp = document.getElementById('period');
    const name = nInp.value.trim() || `T${tasks.length + 1}`;
    const exec = parseInt(cInp.value), period = parseInt(pInp.value);

    if (isNaN(exec) || isNaN(period) || exec <= 0 || period <= 0) return alert('Valid positive numbers required.');
    if (exec > period) return alert('Execution time cannot be > Period.');

    tasks.push({
        id: `t_${Date.now()}`, name: name, executionTime: exec, period: period,
        utilization: exec / period, color: taskColors[tasks.length % taskColors.length]
    });
    nInp.value = ''; cInp.value = ''; pInp.value = '';
    updateUI();
}

function deleteTask(id) {
    tasks = tasks.filter(t => t.id !== id);
    if(renderer) renderer.stop();
    updateUI();
}

function clearTasks() {
    if (renderer) renderer.stop();
    tasks = [];
    updateUI();
    document.getElementById('currentAlg').innerText = '(None)';
    document.getElementById('simClock').innerText = 't = 0';
    renderer.clear();
}

function updateUI() {
    const tList = document.getElementById('taskList'), legBox = document.getElementById('legendContainer');
    tList.innerHTML = ''; legBox.innerHTML = '';
    let totalU = 0;

    if (tasks.length === 0) {
        tList.innerHTML = '<div class="empty-state">No tasks</div>';
        legBox.innerHTML = '<div class="empty-state">No active tasks</div>';
    } else {
        tasks.forEach(task => {
            totalU += task.utilization;
            let percent = (task.utilization * 100).toFixed(1);
            // Task list row
            let li = document.createElement('li'); li.className = 'task-item';
            li.innerHTML = `
                <div style="display:flex;align-items:center;gap:8px;">
                    <span style="width:8px;height:8px;border-radius:50%;background:${task.color};box-shadow:0 0 5px ${task.color}"></span>
                    ${task.name}
                </div>
                <div>${task.executionTime}</div><div>${task.period}</div><div>${percent}%</div>
                <button class="btn-del" onclick="deleteTask('${task.id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>
            `;
            tList.appendChild(li);

            // Legend row
            let legRow = document.createElement('div'); legRow.className = 'legend-row';
            legRow.innerHTML = `
                <div class="leg-t" style="background:${task.color}">${task.name}</div>
                <div>C = ${task.executionTime}</div> <div>T = ${task.period}</div> <div>U = ${percent}%</div>
            `;
            legBox.appendChild(legRow);
        });
        let idleRow = document.createElement('div'); idleRow.className='legend-row';
        idleRow.innerHTML = `<div class="leg-t leg-IDLE">IDLE</div><div style="color:var(--text-secondary)">CPU is idle</div>`;
        legBox.appendChild(idleRow);
    }
    document.getElementById('statTotalTasks').innerText = tasks.length;
    
    let uPer = totalU * 100;
    document.getElementById('utilizationValue').innerText = uPer.toFixed(1) + '%';
    document.getElementById('utilizationValue').style.color = (uPer > 100) ? 'var(--danger-color)' : 'var(--text-primary)';
    document.getElementById('utilizationFill').style.width = Math.min(uPer, 100) + '%';
    document.getElementById('utilizationFill').style.background = (uPer > 100) ? 'var(--danger-color)' : 'var(--primary-solid)';
}

function stopSimulation() {
    if (renderer) renderer.stop();
    document.getElementById('simStatusText').innerText = "STOPPED";
    document.getElementById('simStatus').className = "sim-status stopped";
}
function pauseSimulation() {
    if (renderer) renderer.running = !renderer.running;
    if(renderer.running) renderer.drawLoop(performance.now());
    document.getElementById('simStatusText').innerText = renderer.running ? "RUNNING" : "PAUSED";
}

// ------ Engine ------

class TimelineRenderer {
    constructor() {
        this.canv = document.getElementById('mainCanvas');
        this.ctx = this.canv.getContext('2d');
        this.cpuCanv = document.getElementById('cpuChart');
        this.cpuCtx = this.cpuCanv.getContext('2d');
        this.resize();
        window.addEventListener('resize', () => this.resize());
        
        this.log = []; this.deads = [];
        this.runP = 60; // pixels per time
        this.running = false;
        this.tFloat = 0; this.maxT = 0;
        this.lastT = 0; this.cpuHist = [];
        this.statDone = 0; this.statMiss = 0;

        const tip = document.getElementById('tooltip');
        this.canv.addEventListener('mousemove', e => {
            const r = this.canv.getBoundingClientRect();
            const x = e.clientX - r.left, y = e.clientY - r.top;
            let scrollX = Math.max(0, this.tFloat * this.runP - this.width * 0.85);
            let hoverT = (x + scrollX) / this.runP;
            tip.style.left = (e.clientX + 15) + 'px'; tip.style.top = (e.clientY + 15) + 'px';
            
            let c = null;
            if (y > 30 && y < 140) c = this.log.find(ck => hoverT >= ck.start && hoverT <= Math.min(ck.end, this.tFloat));
            if (c && c.taskId !== 'idle' && c.start <= this.tFloat) {
                tip.innerHTML = `<div style="color:${c.color};font-weight:bold">${c.name}</div>Time: [${c.start} - ${c.end}]<br>Rem C: ${c.remC} | Dead: ${c.deadline}<br>${c.name.includes("Missed")?"<span style='color:#ff0055'>Deadline Miss!</span>":"Executing"}`;
                tip.classList.add('visible');
            } else tip.classList.remove('visible');
        });
        this.canv.addEventListener('mouseleave', () => tip.classList.remove('visible'));
    }
    resize() {
        let p = this.canv.parentElement;
        this.width = this.canv.width = p.clientWidth; this.height = this.canv.height = 400; // Total height for both graphs
        let cp = this.cpuCanv.parentElement;
        this.cpuW = this.cpuCanv.width = cp.clientWidth; this.cpuH = this.cpuCanv.height = 100;
    }
    clear() { this.log=[]; this.deads=[]; this.tFloat=0; this.statDone=0; this.statMiss=0; this.ctx.clearRect(0,0,this.width,this.height); this.cpuCtx.clearRect(0,0,this.cpuW,this.cpuH); }
    stop() { this.running = false; }
    
    loadData(log, deads, maxT) {
        this.log = log; this.deads = deads; this.maxT = maxT;
        this.tFloat = 0; this.lastT = performance.now(); this.cpuHist = [];
        
        let py = 250; this.yMapP = {};
        tasks.forEach(t => { this.yMapP[t.id] = py; py += 35; });
        
        this.running = true;
        this.drawLoop(this.lastT);
    }

    drawLoop(ts) {
        if (!this.running) return;
        let delta = ts - this.lastT; this.lastT = ts;
        let speed = parseInt(document.getElementById('simSpeed').value) || 200;
        
        this.tFloat += delta / speed;
        if (this.tFloat >= this.maxT) { this.tFloat = this.maxT; stopSimulation(); }
        
        document.getElementById('simClock').innerText = `t = ${Math.floor(this.tFloat)}`;
        
        this.renderCanvas(); this.renderCPU();
        if (this.running) requestAnimationFrame(t => this.drawLoop(t));
    }

    renderCanvas() {
        this.ctx.clearRect(0,0,this.width,this.height);
        let scX = Math.max(0, this.tFloat * this.runP - this.width * 0.85);
        this.ctx.save(); this.ctx.translate(-scX, 0);

        // --- BACKGROUND & AXIS ---
        this.ctx.fillStyle = 'rgba(255,255,255,0.03)';
        this.ctx.fillRect(scX, 170, this.width, 30); // Center axis line
        
        this.ctx.beginPath(); this.ctx.strokeStyle = 'rgba(255,255,255,0.08)'; this.ctx.lineWidth=1;
        for (let i = Math.floor(scX/this.runP); i <= Math.ceil((scX+this.width)/this.runP); i++) {
            let x = i * this.runP;
            this.ctx.moveTo(x, 40); this.ctx.lineTo(x, this.height);
            this.ctx.fillStyle = 'rgba(255,255,255,0.5)'; this.ctx.font = '10px "JetBrains Mono"';
            this.ctx.textAlign='center';
            this.ctx.fillText(i, x, 188); // time at center div
        }
        this.ctx.stroke();

        this.ctx.fillStyle = 'rgba(255,255,255,0.4)'; this.ctx.font = '10px Inter';
        this.ctx.textAlign='left'; this.ctx.fillText("CPU EXECUTION TIMELINE", scX+20, 20);
        this.ctx.fillText("PERIOD VIEW (Releases)", scX+20, 215);

        // --- EXECUTION BLOCKS ---
        let blink = Math.sin(performance.now()/150);
        let shake = Math.sin(performance.now()/50) * 3;
        this.log.forEach(chk => {
            if (chk.start > this.tFloat) return;
            let endT = Math.min(chk.end, this.tFloat);
            let w = (endT-chk.start)*this.runP, y = 80, h = 60;
            if(w<=0)return;
            
            let isMiss = chk.name.includes("Missed");
            let x = chk.start*this.runP + (isMiss ? shake : 0);
            
            this.ctx.shadowBlur = chk.originId==='idle'?0:15; this.ctx.shadowColor = chk.color;
            if(isMiss) this.ctx.shadowBlur = 10 + 15*Math.abs(blink);
            
            // Block draw
            this.ctx.fillStyle = chk.taskId==='idle'?'rgba(255,255,255,0.1)':chk.color;
            this.ctx.beginPath(); this.ctx.roundRect(x+1, y, w-2, h, 6); this.ctx.fill();
            
            // Preemption cut smooth effect
            if(chk.taskId !== 'idle' && (chk.remC - (chk.end - chk.start) > 0) && endT === chk.end) {
                this.ctx.beginPath();
                this.ctx.moveTo(x + w - 2, y);
                this.ctx.lineTo(x + w - 8, y + h/2);
                this.ctx.lineTo(x + w - 2, y + h);
                this.ctx.strokeStyle = 'rgba(255,255,255,0.8)'; this.ctx.lineWidth = 2; this.ctx.stroke();
            }
            
            // Text center
            if(w > 20 && chk.taskId!=='idle') {
                this.ctx.shadowBlur=0; this.ctx.fillStyle = '#fff'; this.ctx.font = 'bold 14px Inter'; this.ctx.textAlign='center';
                this.ctx.fillText(chk.name.replace(' (Missed)',''), x + w/2, y + 35);
            }
        });

        // --- DEADLINES TOP ---
        this.ctx.shadowBlur = 0;
        this.deads.forEach(d => {
            if(d.time > this.tFloat) return;
            let x = d.time * this.runP;
            this.ctx.strokeStyle = `rgba(245,158,11,0.8)`;
            this.ctx.lineWidth=2; this.ctx.setLineDash([5,5]);
            this.ctx.beginPath(); this.ctx.moveTo(x, 40); this.ctx.lineTo(x, 140); this.ctx.stroke(); this.ctx.setLineDash([]);
            
            this.ctx.fillStyle = '#f59e0b'; this.ctx.textAlign='center'; this.ctx.font='10px Inter';
            this.ctx.fillText(d.name, x, 30); this.ctx.fillText('D='+d.time, x, 42);
        });

        // --- PERIOD VIEW (Bottom Lines) ---
        tasks.forEach(t => {
            let py = this.yMapP[t.id];
            this.ctx.strokeStyle = 'rgba(255,255,255,0.15)'; this.ctx.lineWidth=1;
            this.ctx.beginPath(); this.ctx.moveTo(scX, py); this.ctx.lineTo(scX+this.width, py); this.ctx.stroke();
            this.ctx.textAlign = 'left'; this.ctx.fillStyle = t.color;
            this.ctx.font = '10px Inter'; this.ctx.fillText(`${t.name} (T=${t.period})`, scX+20, py-5);
        });
        
        this.deads.forEach(d => {
            if(d.time - d.period > this.tFloat) return;
            let py = this.yMapP[d.taskId];
            let drawDiamond = (dx, isActive) => {
                this.ctx.save(); this.ctx.translate(dx, py); this.ctx.rotate(45*Math.PI/180);
                this.ctx.strokeStyle = isActive?d.color:'rgba(255,255,255,0.2)'; this.ctx.lineWidth=2;
                this.ctx.strokeRect(-5, -5, 10, 10);
                this.ctx.restore();
            };
            
            // draw start diamond
            let startX = (d.time - d.period) * this.runP;
            drawDiamond(startX, true);
            this.ctx.fillStyle = 'rgba(255,255,255,0.5)'; this.ctx.textAlign='center';
            this.ctx.fillText((d.time - d.period), startX, py-15);
            
            // line connect
            if(d.time <= this.tFloat) {
                let endX = d.time * this.runP;
                this.ctx.beginPath(); this.ctx.moveTo(startX+7, py); this.ctx.lineTo(endX-7, py); 
                this.ctx.strokeStyle = d.color; this.ctx.stroke();
                drawDiamond(endX, true);
            }
        });

        // --- SWEEPER LINE ---
        let cX = this.tFloat * this.runP;
        this.ctx.strokeStyle = 'rgba(255,255,255,0.9)'; this.ctx.lineWidth = 2;
        this.ctx.shadowBlur = 10; this.ctx.shadowColor = '#fff';
        this.ctx.beginPath(); this.ctx.moveTo(cX, 20); this.ctx.lineTo(cX, this.height-20); this.ctx.stroke();
        this.ctx.beginPath(); this.ctx.arc(cX, 100, 3, 0, 2*Math.PI); this.ctx.fillStyle='#fff'; this.ctx.fill();

        this.ctx.restore();
    }

    renderCPU() {
        this.cpuCtx.clearRect(0,0,this.cpuW,this.cpuH);
        let cur = this.log.find(c => this.tFloat >= c.start && this.tFloat < c.end);
        let u = (cur && cur.taskId!=='idle') ? 1 : 0;
        
        this.cpuHist.push({ t: this.tFloat, u: u });
        if(this.cpuHist.length > 300) this.cpuHist.shift();
        
        let runU = this.cpuHist.map(h=>h.u).reduce((a,b)=>a+b,0) / this.cpuHist.length * 100;
        document.getElementById('liveUtilDisplay').innerText = (u?runU.toFixed(1):'0.0') + '%';
        document.getElementById('miniCpuBadge').innerHTML = (u?runU.toFixed(1):'0.0') + '%<br><span style="font-size:0.6rem;color:var(--text-secondary);font-family:var(--font-family);">Current</span>';
        
        if (this.cpuHist.length < 2) return;
        
        let scX = Math.max(0, this.tFloat * 5 - (this.cpuW-10)); // local compression scale
        this.cpuCtx.beginPath();
        this.cpuCtx.moveTo(0, this.cpuH);
        for(let i=0; i<this.cpuHist.length; i++) {
            let pt = this.cpuHist[i];
            let x = (pt.t * 5) - scX, y = this.cpuH - (pt.u * (this.cpuH - 20)) - 10;
            if(i===0) this.cpuCtx.lineTo(x, y);
            else {
                let px = (this.cpuHist[i-1].t * 5) - scX;
                let py = this.cpuH - (this.cpuHist[i-1].u * (this.cpuH - 20)) - 10;
                let cpX = (x + px) / 2;
                this.cpuCtx.bezierCurveTo(cpX, py, cpX, y, x, y);
            }
        }
        this.cpuCtx.lineTo(this.width, this.cpuH);
        
        let grad = this.cpuCtx.createLinearGradient(0,0,0,this.cpuH);
        grad.addColorStop(0, 'rgba(0, 242, 254, 0.5)');
        grad.addColorStop(1, 'rgba(0, 242, 254, 0)');
        this.cpuCtx.fillStyle = grad; this.cpuCtx.fill();
        
        this.cpuCtx.beginPath();
        for(let i=0; i<this.cpuHist.length; i++) {
            let pt = this.cpuHist[i];
            let x = (pt.t * 5) - scX, y = this.cpuH - (pt.u * (this.cpuH - 20)) - 10;
            if(i===0) this.cpuCtx.moveTo(x,y); 
            else {
                let px = (this.cpuHist[i-1].t * 5) - scX;
                let py = this.cpuH - (this.cpuHist[i-1].u * (this.cpuH - 20)) - 10;
                let cpX = (x + px) / 2;
                this.cpuCtx.bezierCurveTo(cpX, py, cpX, y, x, y);
            }
        }
        this.cpuCtx.strokeStyle = '#00f2fe'; this.cpuCtx.lineWidth=2; this.cpuCtx.stroke();
    }
}

function runSimulation() {
    if (tasks.length === 0) return alert('Add tasks first!');
    if (renderer) renderer.stop();

    document.getElementById('currentAlg').innerText = `(${currentAlg})`;
    document.getElementById('simStatusText').innerText = "RUNNING";
    document.getElementById('simStatus').className = "sim-status running";

    const gcd = (a, b) => b===0 ? a : gcd(b, a % b);
    const lcm = (a, b) => (a*b)/gcd(a, b);
    let hp = tasks.map(t=>t.period).reduce((a,v)=>lcm(a,v), 1);
    let maxT = Math.min(hp, 150);
    document.getElementById('statHyperperiod').innerText = hp;

    let rq = [], log = [], deads = [], chunk = null;
    let doneJobs = 0, missJobs = 0;

    for (let t = 0; t < maxT; t++) {
        tasks.forEach(tsk => {
            if (t % tsk.period === 0) {
                deads.push({ taskId: tsk.id, name: tsk.name, period: tsk.period, time: t + tsk.period, color: tsk.color });
                rq.push({ originId: tsk.id, taskId: tsk.id, name: tsk.name, c: tsk.executionTime, remC: tsk.executionTime, deadline: t + tsk.period, period: tsk.period, color: tsk.color });
            }
        });

        rq.forEach(job => {
            if (t >= job.deadline && job.remC > 0 && job.color !== '#ff0055') {
                job.color = '#ff0055'; job.name += " (Missed)"; job.taskId += "_miss";
                missJobs++;
            }
        });

        if (currentAlg === 'RM') rq.sort((a,b) => a.period!==b.period ? a.period-b.period : a.taskId.localeCompare(b.taskId));
        else rq.sort((a,b) => a.deadline!==b.deadline ? a.deadline-b.deadline : a.taskId.localeCompare(b.taskId));

        let act = rq[0] || null;
        if (chunk && act && chunk.taskId === act.taskId) chunk.end = t+1;
        else if (chunk && !act && chunk.taskId === 'idle') chunk.end = t+1;
        else {
            if (chunk) log.push(chunk);
            chunk = act ? { originId: act.originId, taskId: act.taskId, name: act.name, start: t, end: t+1, color: act.color, deadline: act.deadline, remC: act.remC } 
                        : { originId: 'idle', taskId: 'idle', name: 'IDLE', start: t, end: t+1, color: 'gray' };
        }

        if (act) { act.remC--; if (act.remC <= 0) { rq.shift(); if(!act.name.includes("Missed")) doneJobs++; } }
    }
    if (chunk) log.push(chunk);
    
    document.getElementById('statCompleted').innerText = doneJobs;
    document.getElementById('statMissed').innerText = missJobs;
    
    renderer.loadData(log, deads, maxT);
}

function openModal() { document.getElementById('howItWorksModal').style.display = 'flex'; }
function closeModal() { document.getElementById('howItWorksModal').style.display = 'none'; }
function toggleTheme() {
    document.body.classList.toggle('light-theme');
    if(renderer && renderer.log.length > 0) { renderer.renderCanvas(); renderer.renderCPU(); }
}
