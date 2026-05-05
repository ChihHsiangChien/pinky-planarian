/**
 * Pinky Planarian Garden
 * Version: v1.03-debug
 */

// --- 0. Debugger ---
const debugInfo = {
    logs: [],
    log(msg) {
        console.log(msg);
        this.logs.push(msg);
        const el = document.getElementById('debug-console');
        if (el) el.innerText = this.logs.slice(-5).join('\n');
    }
};

window.onerror = function(msg, url, line) {
    debugInfo.log(`ERR: ${msg} (at ${line})`);
};

// --- 1. Constants & Globals ---
const canvas = document.getElementById('game-canvas');
const bodiesLayer = document.getElementById('bodies-layer');
const eyesLayer = document.getElementById('eyes-layer');
const seaweedLayer = document.getElementById('seaweed-layer');
const foodLayer = document.getElementById('food-layer');
const fxLayer = document.getElementById('fx-layer');
const dirtyLayer = document.getElementById('dirty-layer');
const statCount = document.getElementById('stat-count');
const statPurity = document.getElementById('stat-purity');

const PINK_COLORS = ['#ffb7c5', '#ffc0cb', '#ffd1dc', '#ff9aa2', '#ffb3ba', '#e2bbfd'];

let width, height;
let planarians = [];
let seaweeds = [];
let foods = [];
let currentMode = 'observe';
let waterPurity = 100;
let mouseX = 0, mouseY = 0;
let isPointerDown = false;
let saveTimer = 0;
let socialTimer = 0;

// --- 2. Physics Engine ---
class Point {
    constructor(x, y, isStatic = false) {
        this.x = x; this.y = y;
        this.oldX = x; this.oldY = y;
        this.isStatic = isStatic;
    }
    update(friction = 0.98, gravity = 0) {
        if (this.isStatic) return;
        const vx = (this.x - this.oldX) * friction;
        const vy = (this.y - this.oldY) * friction;
        this.oldX = this.x; this.oldY = this.y;
        this.x += vx; this.y += vy + gravity;
    }
    applyForce(fx, fy) {
        if (this.isStatic) return;
        this.x += fx; this.y += fy;
    }
}

class Constraint {
    constructor(p1, p2, length) {
        this.p1 = p1; this.p2 = p2;
        this.length = length;
    }
    resolve() {
        const dx = this.p2.x - this.p1.x;
        const dy = this.p2.y - this.p1.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.1;
        const diff = (this.length - dist) / dist;
        const offsetX = dx * diff * 0.5;
        const offsetY = dy * diff * 0.5;
        if (!this.p1.isStatic) { this.p1.x -= offsetX; this.p1.y -= offsetY; }
        if (!this.p2.isStatic) { this.p2.x += offsetX; this.p2.y += offsetY; }
    }
}

// --- 3. Biological Classes ---
class Planarian {
    constructor(x, y, numNodes = 7, nodeDist = 15, existingPoints = null, color = null) {
        this.points = existingPoints || [];
        this.constraints = [];
        this.hasHead = true;
        this.regrowTimer = 0;
        this.stunTimer = 0;
        this.eatCount = 0;
        this.angle = Math.random() * Math.PI * 2;
        this.speed = 0.2 + Math.random() * 0.3;
        this.nodeDist = nodeDist;
        this.baseRadii = [];
        this.color = color || PINK_COLORS[Math.floor(Math.random() * PINK_COLORS.length)];
        this.lastKissTime = 0;

        if (this.points.length === 0) {
            for (let i = 0; i < numNodes; i++) {
                this.points.push(new Point(x + i * nodeDist, y));
            }
        }
        this.rebuildConstraints();

        this.bodyGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
        bodiesLayer.appendChild(this.bodyGroup);
        this.eyeGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
        eyesLayer.appendChild(this.eyeGroup);

        this.bodySegments = [];
        for (let i = 0; i < this.points.length; i++) {
            const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
            circle.setAttribute("class", "planarian-body");
            circle.setAttribute("fill", this.color);
            const radius = Math.max(2, nodeDist * (1 - i / this.points.length) * 1.2);
            circle.setAttribute("r", radius);
            this.baseRadii.push(radius);
            this.bodyGroup.appendChild(circle);
            this.bodySegments.push(circle);
        }

        this.head = document.createElementNS("http://www.w3.org/2000/svg", "path");
        this.head.setAttribute("fill", this.color);
        this.bodyGroup.appendChild(this.head);

        this.eyeWhiteL = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        this.eyeWhiteR = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        this.eyeWhiteL.setAttribute("fill", "white");
        this.eyeWhiteR.setAttribute("fill", "white");
        this.eyeWhiteL.setAttribute("r", "4.5");
        this.eyeWhiteR.setAttribute("r", "4.5");
        this.eyeGroup.appendChild(this.eyeWhiteL);
        this.eyeGroup.appendChild(this.eyeWhiteR);

        this.eyeL = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        this.eyeR = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        this.eyeL.setAttribute("class", "planarian-eye");
        this.eyeR.setAttribute("class", "planarian-eye");
        this.eyeL.setAttribute("r", "2");
        this.eyeR.setAttribute("r", "2");
        this.eyeGroup.appendChild(this.eyeL);
        this.eyeGroup.appendChild(this.eyeR);
    }

    rebuildConstraints() {
        this.constraints = [];
        for (let i = 0; i < this.points.length - 1; i++) {
            this.constraints.push(new Constraint(this.points[i], this.points[i+1], this.nodeDist));
        }
    }

    update() {
        if (this.stunTimer > 0) {
            this.stunTimer--;
            this.points.forEach(p => { p.oldX = p.x; p.oldY = p.y; });
        }

        if (!this.hasHead) {
            if (++this.regrowTimer > 1800) { this.hasHead = true; this.regrowTimer = 0; }
        }

        const shrinkRate = 0.00005 * (1 + (100 - waterPurity) / 50);
        this.baseRadii = this.baseRadii.map(r => Math.max(1.5, r * (1 - shrinkRate)));
        this.constraints.forEach(c => c.length = Math.max(5, c.length * (1 - shrinkRate)));

        if (this.hasHead && this.stunTimer === 0) {
            let foundTarget = false;
            const head = this.points[0];
            const nightFactor = window.isNight ? 0.4 : 1.0;
            const healthFactor = (0.3 + (waterPurity / 100) * 0.7) * nightFactor;
            const currentSpeed = this.speed * healthFactor;

            if (currentMode === 'observe') {
                const d = distance(head, {x: mouseX, y: mouseY});
                if (d < 150) {
                    const angle = Math.atan2(mouseY - head.y, mouseX - head.x);
                    head.applyForce(Math.cos(angle) * 0.2, Math.sin(angle) * 0.2);
                    this.angle = angle;
                    foundTarget = true;
                }
            }

            if (window.bellTarget) {
                const dx = window.bellTarget.x - head.x;
                const dy = window.bellTarget.y - head.y;
                const angle = Math.atan2(dy, dx);
                head.applyForce(Math.cos(angle) * 0.8 * healthFactor, Math.sin(angle) * 0.8 * healthFactor);
                foundTarget = true;
            } else if (foods.length > 0) {
                let nearest = null, minDist = Infinity;
                foods.forEach(f => {
                    const d = distance(head, f);
                    if (d < minDist) { minDist = d; nearest = f; }
                });
                if (minDist < 300) {
                    const angle = Math.atan2(nearest.y - head.y, nearest.x - head.x);
                    head.applyForce(Math.cos(angle) * 0.5 * healthFactor, Math.sin(angle) * 0.5 * healthFactor);
                    foundTarget = true;
                    if (minDist < 15) {
                        const idx = foods.indexOf(nearest);
                        if (idx > -1) {
                            foods.splice(idx, 1); foodLayer.children[idx].remove();
                            this.grow(); audio.playEat(); createHeartBurst(nearest.x, nearest.y);
                            waterPurity = Math.max(0, waterPurity - 5);
                        }
                    }
                }
            }

            if (!foundTarget) {
                this.angle += (Math.random() - 0.5) * 0.2;
                head.applyForce(Math.cos(this.angle) * currentSpeed, Math.sin(this.angle) * currentSpeed);
            }

            const margin = 100;
            if (head.x < margin) head.applyForce(0.4 * (1 - head.x/margin), 0);
            if (head.x > width - margin) head.applyForce(-0.4 * (1 - (width - head.x)/margin), 0);
            if (head.y < margin) head.applyForce(0, 0.4 * (1 - head.y/margin));
            if (head.y > height - margin) head.applyForce(0, -0.4 * (1 - (height - head.y)/margin));
        }

        this.points.forEach(p => p.update());
        for (let i = 0; i < 2; i++) this.constraints.forEach(c => c.resolve());
        this.render();
    }

    render() {
        if (this.points.length < 2) return;
        const pulse = 1 + Math.sin(Date.now() * 0.005) * 0.05;
        this.points.forEach((p, i) => {
            if (this.bodySegments[i]) {
                this.bodySegments[i].setAttribute("cx", p.x);
                this.bodySegments[i].setAttribute("cy", p.y);
                this.bodySegments[i].setAttribute("r", this.baseRadii[i] * pulse);
            }
        });

        if (this.hasHead) {
            const h = this.points[0], n = this.points[1];
            const angle = Math.atan2(h.y - n.y, h.x - n.x);
            const headSize = 18, auricleAngle = 0.8;
            const x1 = h.x + Math.cos(angle) * headSize, y1 = h.y + Math.sin(angle) * headSize;
            const x2 = h.x + Math.cos(angle - auricleAngle) * headSize * 0.8, y2 = h.y + Math.sin(angle - auricleAngle) * headSize * 0.8;
            const x3 = h.x + Math.cos(angle + auricleAngle) * headSize * 0.8, y3 = h.y + Math.sin(angle + auricleAngle) * headSize * 0.8;
            this.head.setAttribute("d", `M ${x1} ${y1} L ${x2} ${y2} L ${h.x} ${h.y} L ${x3} ${y3} Z`);
            this.head.style.display = "block";

            const eyeDist = 12, eyeForward = 6;
            const lwx = h.x + Math.cos(angle) * eyeForward - Math.sin(angle) * eyeDist/2;
            const lwy = h.y + Math.sin(angle) * eyeForward + Math.cos(angle) * eyeDist/2;
            const rwx = h.x + Math.cos(angle) * eyeForward + Math.sin(angle) * eyeDist/2;
            const rwy = h.y + Math.sin(angle) * eyeForward - Math.cos(angle) * eyeDist/2;
            this.eyeWhiteL.setAttribute("cx", lwx); this.eyeWhiteL.setAttribute("cy", lwy);
            this.eyeWhiteR.setAttribute("cx", rwx); this.eyeWhiteR.setAttribute("cy", rwy);
            this.eyeWhiteL.style.display = this.eyeWhiteR.style.display = "block";

            const pupilInward = 1.5;
            this.eyeL.setAttribute("cx", lwx + Math.sin(angle) * pupilInward);
            this.eyeL.setAttribute("cy", lwy - Math.cos(angle) * pupilInward);
            this.eyeR.setAttribute("cx", rwx - Math.sin(angle) * pupilInward);
            this.eyeR.setAttribute("cy", rwy + Math.cos(angle) * pupilInward);
            this.eyeL.style.display = this.eyeR.style.display = "block";
        } else {
            this.head.style.display = "none";
            this.eyeWhiteL.style.display = this.eyeWhiteR.style.display = "none";
            this.eyeL.style.display = this.eyeR.style.display = "none";
        }
    }

    grow() {
        this.eatCount++;
        this.constraints.forEach(c => c.length *= 1.02);
        this.baseRadii = this.baseRadii.map(r => r * 1.02);
        if (this.eatCount % 3 === 0) {
            const lp = this.points[this.points.length - 1], slp = this.points[this.points.length - 2];
            const newPoint = new Point(lp.x + (lp.x - slp.x), lp.y + (lp.y - slp.y));
            this.points.push(newPoint);
            this.constraints.push(new Constraint(lp, newPoint, this.nodeDist));
            const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
            circle.setAttribute("class", "planarian-body"); circle.setAttribute("fill", this.color);
            const r = 2 * (1.02 ** this.eatCount); circle.setAttribute("r", r);
            this.baseRadii.push(r); this.bodyGroup.insertBefore(circle, this.head); this.bodySegments.push(circle);
        }
    }
    destroy() { this.bodyGroup.remove(); this.eyeGroup.remove(); }
}

class Seaweed {
    constructor(x, y, numNodes = 8) {
        this.points = []; this.constraints = []; this.nodeDist = 12 + Math.random() * 8;
        for (let i = 0; i < numNodes; i++) this.points.push(new Point(x, y - i * this.nodeDist, i === 0));
        for (let i = 0; i < numNodes - 1; i++) this.constraints.push(new Constraint(this.points[i], this.points[i+1], this.nodeDist));
        this.path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        this.path.setAttribute("fill", "none"); this.path.setAttribute("stroke", "#b2f2bb");
        this.path.setAttribute("stroke-width", "8"); this.path.setAttribute("stroke-linecap", "round");
        seaweedLayer.appendChild(this.path);
    }
    update() {
        const sway = Math.sin(Date.now() * 0.001 + this.points[0].x) * 0.2;
        for (let i = 1; i < this.points.length; i++) this.points[i].applyForce(sway * i, 0);
        this.points.forEach(p => {
            if (distance(p, {x: mouseX, y: mouseY}) < 50) p.applyForce((p.x - mouseX) * 0.1, 0);
        });
        this.points.forEach(p => p.update(0.95));
        for (let i = 0; i < 2; i++) this.constraints.forEach(c => c.resolve());
        let d = `M ${this.points[0].x} ${this.points[0].y}`;
        for (let i = 0; i < this.points.length - 1; i++) {
            const midX = (this.points[i].x + this.points[i+1].x) / 2;
            const midY = (this.points[i].y + this.points[i+1].y) / 2;
            d += ` Q ${this.points[i].x} ${this.points[i].y} ${midX} ${midY}`;
        }
        this.path.setAttribute("d", d);
    }
}

// --- 4. Audio Engine ---
class AudioEngine {
    constructor() {
        this.ctx = null; this.isStarted = false;
        this.scale = [261.63, 329.63, 392.00, 493.88, 587.33, 659.25, 783.99];
    }
    start() {
        if (this.isStarted) return;
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.isStarted = true; this.playBGM();
    }
    playBGM() {
        const tick = (step) => {
            const now = this.ctx.currentTime;
            if (step % 3 === 0) this.playNote(this.scale[0] / 2, now, 0.15, 1.5, 'sine');
            this.playNote(this.scale[step % this.scale.length], now, 0.08, 0.4);
            if (Math.random() > 0.7) this.playNote(this.scale[Math.floor(Math.random() * this.scale.length)] * 2, now + 0.25, 0.05, 0.2);
            setTimeout(() => tick(step + 1), 500);
        };
        tick(0);
    }
    playNote(freq, time, vol, dur, type = 'triangle') {
        const osc = this.ctx.createOscillator(); const g = this.ctx.createGain();
        osc.type = type; osc.frequency.setValueAtTime(freq, time);
        g.gain.setValueAtTime(vol, time); g.gain.exponentialRampToValueAtTime(0.001, time + dur);
        osc.connect(g); g.connect(this.ctx.destination);
        osc.start(time); osc.stop(time + dur);
    }
    playCut() { this.playNote(1000 + Math.random() * 1000, this.ctx.currentTime, 0.2, 0.1, 'square'); }
    playEat() { this.playNote(783.99, this.ctx.currentTime, 0.2, 0.3); this.playNote(1046.5, this.ctx.currentTime + 0.1, 0.1, 0.2); }
    playClean() { for(let i=0; i<8; i++) this.playNote(400 + Math.random() * 800, this.ctx.currentTime + i * 0.05, 0.05, 0.1, 'sine'); }
    playTease() { this.playNote(880 + Math.random() * 400, this.ctx.currentTime, 0.1, 0.1, 'sine'); }
    playBell() { const n = this.ctx.currentTime; this.playNote(1567.98, n, 0.2, 0.5); this.playNote(1318.51, n + 0.1, 0.1, 0.4); }
    playKiss() { const n = this.ctx.currentTime; this.playNote(1174.66, n, 0.1, 0.1, 'sine'); this.playNote(1567.98, n + 0.05, 0.1, 0.2, 'sine'); }
}

const audio = new AudioEngine();

// --- 5. Logic & Initialization ---
function resize() {
    width = window.innerWidth; height = window.innerHeight;
    canvas.setAttribute("viewBox", `0 0 ${width} ${height}`);
    debugInfo.log(`Resized: ${width}x${height}`);
}

function init() {
    debugInfo.log("Initializing...");
    resize();
    if (width <= 0 || height <= 0) { 
        debugInfo.log("Width/Height is zero, retrying...");
        setTimeout(init, 500); return; 
    }
    window.addEventListener('resize', resize);

    try {
        if (!loadState()) {
            debugInfo.log("No save state found, creating initials...");
            for (let i = 0; i < 3; i++) planarians.push(new Planarian(width/2, height/2));
        }
        debugInfo.log(`Planarians: ${planarians.length}`);
        for (let i = 0; i < 5; i++) seaweeds.push(new Seaweed((width/6)*(i+1), height));
        debugInfo.log(`Seaweeds: ${seaweeds.length}`);
    } catch(e) {
        debugInfo.log(`Init Error: ${e.message}`);
    }

    window.addEventListener('pointerdown', () => audio.start(), { once: true });
    debugInfo.log("Starting Loop...");
    requestAnimationFrame(loop);
}

function loop() {
    waterPurity = Math.max(0, waterPurity - 0.01);
    dirtyLayer.setAttribute("opacity", (1 - waterPurity / 100) * 0.3);
    statCount.innerText = planarians.length;
    statPurity.innerText = Math.round(waterPurity) + '%';

    const time = (Date.now() / 120000) % 1;
    if (time < 0.4) { canvas.style.backgroundColor = `hsl(187, 60%, ${92 + Math.sin(time * 10) * 2}%)`; window.isNight = false; }
    else if (time < 0.6) { const t = (time-0.4)/0.2; canvas.style.backgroundColor = `hsl(${187-t*160}, ${60+t*20}%, ${92-t*40}%)`; window.isNight = t > 0.5; }
    else if (time < 0.9) { canvas.style.backgroundColor = `hsl(27, 80%, 30%)`; window.isNight = true; }
    else { const t = (time-0.9)/0.1; canvas.style.backgroundColor = `hsl(${27+t*160}, ${80-t*20}%, ${30+t*62}%)`; window.isNight = false; }

    if (++socialTimer > 10) { checkSocial(); socialTimer = 0; }
    if (++saveTimer > 300) { saveState(); saveTimer = 0; }

    if (isPointerDown) {
        if (currentMode === 'cut') checkCut(mouseX, mouseY);
        else if (currentMode === 'tease') checkTease(mouseX, mouseY);
    }
    seaweeds.forEach(s => s.update());
    planarians.forEach(p => p.update());
    requestAnimationFrame(loop);
}

// --- 6. Utilities & Events ---
function saveState() {
    try {
        const data = planarians.map(p => ({
            points: p.points.map(pt => ({x: pt.x, y: pt.y})),
            hasHead: p.hasHead, color: p.color, nodeDist: p.nodeDist, eatCount: p.eatCount
        }));
        localStorage.setItem('pinky_planarian_state', JSON.stringify({ planarians: data, waterPurity: waterPurity }));
    } catch(e) { debugInfo.log("Save Fail"); }
}

function loadState() {
    try {
        const saved = localStorage.getItem('pinky_planarian_state');
        if (!saved) return false;
        const data = JSON.parse(saved);
        waterPurity = data.waterPurity || 100;
        data.planarians.forEach(d => {
            const pts = d.points.map(pt => new Point(pt.x, pt.y));
            const p = new Planarian(0, 0, pts.length, d.nodeDist, pts, d.color);
            p.hasHead = d.hasHead; p.eatCount = d.eatCount || 0; planarians.push(p);
        });
        return true;
    } catch (e) { return false; }
}

function createHeartBurst(x, y) {
    for (let i = 0; i < 6; i++) {
        const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
        p.setAttribute("d", "M 10,30 A 20,20 0,0,1 50,30 A 20,20 0,0,1 90,30 Q 90,60 50,90 Q 10,60 10,30 z");
        p.setAttribute("fill", "#ff4d6d");
        const s = 0.05 + Math.random()*0.1, a = Math.random()*Math.PI*2, dist = 20+Math.random()*30;
        fxLayer.appendChild(p);
        let t = 0;
        function anim() {
            t += 0.05; const curD = dist*t;
            p.setAttribute("transform", `translate(${x + Math.cos(a)*curD}, ${y + Math.sin(a)*curD}) scale(${s})`);
            p.style.opacity = 1 - t; if (t < 1) requestAnimationFrame(anim); else p.remove();
        }
        anim();
    }
}

function checkSocial() {
    const now = Date.now();
    for (let i = 0; i < planarians.length; i++) {
        for (let j = i + 1; j < planarians.length; j++) {
            const p1 = planarians[i], p2 = planarians[j];
            if (!p1.hasHead || !p2.hasHead) continue;
            if (distance(p1.points[0], p2.points[0]) < 30 && now - p1.lastKissTime > 5000) {
                p1.lastKissTime = p2.lastKissTime = now;
                const mx = (p1.points[0].x + p2.points[0].x)/2, my = (p1.points[0].y + p2.points[0].y)/2;
                createRipple(mx, my, "#ff4d6d"); createHeartBurst(mx, my); audio.playKiss();
            }
        }
    }
}

function checkCut(x, y) {
    createSparkle(x, y);
    let i = planarians.length;
    while (i--) {
        const p = planarians[i];
        for (let j = 0; j < p.points.length - 1; j++) {
            if (distToSegment({x, y}, p.points[j], p.points[j+1]) < 20 && p.points.length >= 6) {
                splitPlanarian(i, j); return;
            }
        }
    }
}

function createSparkle(x, y) {
    const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    c.setAttribute("cx", x + (Math.random()-0.5)*10); c.setAttribute("cy", y + (Math.random()-0.5)*10);
    c.setAttribute("r", 1+Math.random()*3); c.setAttribute("fill", "#ff8fa3"); fxLayer.appendChild(c);
    let o = 1; function a() { o -= 0.05; c.style.opacity = o; if (o > 0) requestAnimationFrame(a); else c.remove(); }
    a();
}

function distToSegment(p, v, w) {
    const l2 = (v.x - w.x)**2 + (v.y - w.y)**2;
    if (l2 == 0) return distance(p, v);
    let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
    t = Math.max(0, Math.min(1, t));
    return distance(p, { x: v.x + t * (w.x - v.x), y: v.y + t * (w.y - v.y) });
}

function splitPlanarian(idx, splitIdx) {
    if (planarians.length >= 20) return;
    audio.playCut();
    const p = planarians[idx];
    const p1pts = p.points.slice(0, splitIdx + 1), p2pts = p.points.slice(splitIdx + 1);
    if (p1pts.length < 3 || p2pts.length < 3) return;
    [...p1pts, ...p2pts].forEach(pt => { pt.oldX = pt.x; pt.oldY = pt.y; });
    const nd = p.nodeDist, clr = p.color;
    p.destroy(); planarians.splice(idx, 1);
    const n1 = new Planarian(0, 0, p1pts.length, nd, p1pts, clr); n1.stunTimer = 60; planarians.push(n1);
    const n2 = new Planarian(0, 0, p2pts.length, nd, p2pts, clr); n2.hasHead = false; n2.stunTimer = 60; planarians.push(n2);
}

function createBubbles() {
    audio.playClean(); waterPurity = 100;
    planarians.forEach(p => {
        p.stunTimer = 60;
        p.points.forEach(pt => pt.applyForce((Math.random()-0.5)*30, 40+Math.random()*40));
        p.angle += Math.PI;
    });
    for (let i = 0; i < 20; i++) {
        const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        const x = Math.random()*width, r = 5+Math.random()*15;
        c.setAttribute("cx", x); c.setAttribute("cy", height+50); c.setAttribute("r", r);
        c.setAttribute("fill", "white"); c.setAttribute("opacity", "0.5"); fxLayer.appendChild(c);
        let curY = height+50, spd = 3+Math.random()*5;
        function a() { curY -= spd; c.setAttribute("cy", curY); if (curY > -50) requestAnimationFrame(a); else c.remove(); }
        a();
    }
}

function resetGarden() {
    planarians.forEach(p => p.destroy()); planarians = []; foods = []; foodLayer.innerHTML = '';
    waterPurity = 100; localStorage.removeItem('pinky_planarian_state');
    for (let i = 0; i < 3; i++) planarians.push(new Planarian(width/2 + (Math.random()-0.5)*200, height/2 + (Math.random()-0.5)*200));
}

function createRipple(x, y, color = "rgba(255, 255, 255, 0.5)") {
    const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    c.setAttribute("cx", x); c.setAttribute("cy", y); c.setAttribute("r", "5");
    c.setAttribute("class", "ripple"); c.style.stroke = color;
    fxLayer.appendChild(c);
    let r = 5, o = 1;
    function a() { r += 2; o -= 0.02; c.setAttribute("r", r); c.style.opacity = o; if (o > 0) requestAnimationFrame(a); else c.remove(); }
    a();
}

function triggerBell(x, y) {
    audio.playBell(); window.bellTarget = {x, y}; createRipple(x, y, "#ff8fa3");
    setTimeout(() => { window.bellTarget = null; }, 3000);
}

// --- Interaction Logic (Mouse) ---
window.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    mouseX = e.clientX - rect.left; mouseY = e.clientY - rect.top;
});

// --- Start ---
init();
