/**
 * 粉萌渦蟲養殖場 (Pinky Planarian Garden)
 * Core Physics: Verlet Integration
 */

const canvas = document.getElementById('game-canvas');
const bodiesLayer = document.getElementById('bodies-layer');
const eyesLayer = document.getElementById('eyes-layer');
const foodLayer = document.getElementById('food-layer');
const fxLayer = document.getElementById('fx-layer');

let width, height;
let planarians = [];
let foods = [];
let currentMode = 'observe'; // observe, feed, cut, tease, bell, clean
let waterPurity = 100;
let mouseX = 0, mouseY = 0;
let isPointerDown = false;

const dirtyLayer = document.getElementById('dirty-layer');

// --- Utilities ---
const distance = (p1, p2) => Math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2);

// --- Verlet Physics ---
class Point {
    constructor(x, y, isStatic = false) {
        this.x = x;
        this.y = y;
        this.oldX = x;
        this.oldY = y;
        this.isStatic = isStatic;
    }

    update(friction = 0.98, gravity = 0) {
        if (this.isStatic) return;

        const vx = (this.x - this.oldX) * friction;
        const vy = (this.y - this.oldY) * friction;

        this.oldX = this.x;
        this.oldY = this.y;
        this.x += vx;
        this.y += vy + gravity;
    }

    applyForce(fx, fy) {
        if (this.isStatic) return;
        this.x += fx;
        this.y += fy;
    }
}

class Constraint {
    constructor(p1, p2, length) {
        this.p1 = p1;
        this.p2 = p2;
        this.length = length;
    }

    resolve() {
        const dx = this.p2.x - this.p1.x;
        const dy = this.p2.y - this.p1.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const diff = (this.length - dist) / dist;
        const offsetX = dx * diff * 0.5;
        const offsetY = dy * diff * 0.5;

        if (!this.p1.isStatic) {
            this.p1.x -= offsetX;
            this.p1.y -= offsetY;
        }
        if (!this.p2.isStatic) {
            this.p2.x += offsetX;
            this.p2.y += offsetY;
        }
    }
}

// --- Planarian ---
const PINK_COLORS = ['#ffb7c5', '#ffc0cb', '#ffd1dc', '#ff9aa2', '#ffb3ba', '#e2bbfd'];

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


        // 如果沒有傳入現有節點，則初始化新節點
        if (this.points.length === 0) {
            for (let i = 0; i < numNodes; i++) {
                this.points.push(new Point(x + i * nodeDist, y));
            }
        }

        // 重新建立物理約束
        this.rebuildConstraints();

        // DOM elements: 分成兩個群組以解決濾鏡模糊問題
        this.bodyGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
        bodiesLayer.appendChild(this.bodyGroup);

        this.eyeGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
        eyesLayer.appendChild(this.eyeGroup);

        this.bodySegments = [];
        for (let i = 0; i < numNodes; i++) {
            const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
            circle.setAttribute("class", "planarian-body");
            circle.setAttribute("fill", this.color);
            const radius = Math.max(2, nodeDist * (1 - i / numNodes) * 1.2);
            circle.setAttribute("r", radius);
            this.baseRadii.push(radius);
            this.bodyGroup.appendChild(circle);
            this.bodySegments.push(circle);
        }

        this.head = document.createElementNS("http://www.w3.org/2000/svg", "path");
        this.head.setAttribute("class", "planarian-body");
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
            this.constraints.push(new Constraint(this.points[i], this.points[i + 1], this.nodeDist));
        }
    }

    update() {
        // Stun logic
        if (this.stunTimer > 0) {
            this.stunTimer--;
            // Apply heavy friction during stun
            this.points.forEach(p => {
                p.oldX = p.x;
                p.oldY = p.y;
            });
        }

        // Regeneration logic
        if (!this.hasHead) {
            this.regrowTimer += 1;
            if (this.regrowTimer > 1800) { // ~30 seconds
                this.hasHead = true;
                this.regrowTimer = 0;
            }
        }

        // Movement (Wander, Seek food, or Seek Bell)
        if (this.hasHead && this.stunTimer === 0) {
            let foundTarget = false;
            const head = this.points[0];

            // Environment effect: Water Purity affects speed
            const healthFactor = 0.3 + (waterPurity / 100) * 0.7;
            const currentSpeed = this.speed * healthFactor;

            // 0. Observe Curiosity
            if (currentMode === 'observe') {
                const d = distance(head, {x: mouseX, y: mouseY});
                if (d < 150) {
                    const dx = mouseX - head.x;
                    const dy = mouseY - head.y;
                    const angle = Math.atan2(dy, dx);
                    // Slow down and look at mouse
                    head.applyForce(Math.cos(angle) * 0.2, Math.sin(angle) * 0.2);
                    this.angle = angle;
                    foundTarget = true;
                }
            }

            // 1. Seek Bell
            if (window.bellTarget) {
                const d = distance(head, window.bellTarget);
                const dx = window.bellTarget.x - head.x;
                const dy = window.bellTarget.y - head.y;
                const angle = Math.atan2(dy, dx);
                head.applyForce(Math.cos(angle) * 0.8 * healthFactor, Math.sin(angle) * 0.8 * healthFactor);
                foundTarget = true;
            } 
            // 2. Seek Food
            else if (foods.length > 0) {
                let nearest = null;
                let minDist = Infinity;
                foods.forEach(f => {
                    const d = distance(head, f);
                    if (d < minDist) {
                        minDist = d;
                        nearest = f;
                    }
                });

                if (minDist < 300) {
                    const dx = nearest.x - head.x;
                    const dy = nearest.y - head.y;
                    const angle = Math.atan2(dy, dx);
                    head.applyForce(Math.cos(angle) * 0.5 * healthFactor, Math.sin(angle) * 0.5 * healthFactor);
                    foundTarget = true;

                    if (minDist < 15) {
                        const idx = foods.indexOf(nearest);
                        if (idx > -1) {
                            foods.splice(idx, 1);
                            foodLayer.children[idx].remove();
                            this.grow();
                            audio.playEat();
                            // Eating makes water slightly dirtier
                            waterPurity = Math.max(0, waterPurity - 5);
                        }
                    }
                }
            }

            if (!foundTarget) {
                this.angle += (Math.random() - 0.5) * 0.2;
                head.applyForce(Math.cos(this.angle) * currentSpeed, Math.sin(this.angle) * currentSpeed);
            }

            // --- Fear of Corners (Avoid sticking to edges) ---
            const margin = 100;
            const turnForce = 0.4;
            if (head.x < margin) head.applyForce(turnForce * (1 - head.x/margin), 0);
            if (head.x > width - margin) head.applyForce(-turnForce * (1 - (width - head.x)/margin), 0);
            if (head.y < margin) head.applyForce(0, turnForce * (1 - head.y/margin));
            if (head.y > height - margin) head.applyForce(0, -turnForce * (1 - (height - head.y)/margin));
        }

        // Verlet steps
        this.points.forEach(p => p.update());
        // v0.03: 2 iterations is enough
        for (let i = 0; i < 2; i++) {
            this.constraints.forEach(c => c.resolve());
        }

        this.render();
    }

    render() {
        if (this.points.length < 2) return;

        // Pulse effect on radius (lighter than CSS transform)
        const pulse = 1 + Math.sin(Date.now() * 0.005) * 0.05;

        // Update body segments (circles)
        this.points.forEach((p, i) => {
            if (this.bodySegments[i]) {
                this.bodySegments[i].setAttribute("cx", p.x);
                this.bodySegments[i].setAttribute("cy", p.y);
                this.bodySegments[i].setAttribute("r", this.baseRadii[i] * pulse);
            }
        });

        // Draw spade head
        if (this.hasHead) {
            const h = this.points[0];
            const n = this.points[1];
            const angle = Math.atan2(h.y - n.y, h.x - n.x);
            
            const headSize = 18;
            const auricleAngle = 0.8; // Angle for the "ears"
            
            const x1 = h.x + Math.cos(angle) * headSize;
            const y1 = h.y + Math.sin(angle) * headSize;
            
            const x2 = h.x + Math.cos(angle - auricleAngle) * headSize * 0.8;
            const y2 = h.y + Math.sin(angle - auricleAngle) * headSize * 0.8;
            
            const x3 = h.x + Math.cos(angle + auricleAngle) * headSize * 0.8;
            const y3 = h.y + Math.sin(angle + auricleAngle) * headSize * 0.8;

            const d = `M ${x1} ${y1} L ${x2} ${y2} L ${h.x} ${h.y} L ${x3} ${y3} Z`;
            this.head.setAttribute("d", d);
            this.head.style.display = "block";

            // Eyes position
            const eyeDist = 12; // Wider apart
            const eyeForward = 6;
            
            // White part (Sclera)
            const lwx = h.x + Math.cos(angle) * eyeForward - Math.sin(angle) * eyeDist/2;
            const lwy = h.y + Math.sin(angle) * eyeForward + Math.cos(angle) * eyeDist/2;
            const rwx = h.x + Math.cos(angle) * eyeForward + Math.sin(angle) * eyeDist/2;
            const rwy = h.y + Math.sin(angle) * eyeForward - Math.cos(angle) * eyeDist/2;

            this.eyeWhiteL.setAttribute("cx", lwx);
            this.eyeWhiteL.setAttribute("cy", lwy);
            this.eyeWhiteR.setAttribute("cx", rwx);
            this.eyeWhiteR.setAttribute("cy", rwy);
            this.eyeWhiteL.style.display = "block";
            this.eyeWhiteR.style.display = "block";

            // Black part (Pupil) - slightly inward for a "derpy" look
            const pupilInward = 1.5;
            const lx = lwx + Math.sin(angle) * pupilInward;
            const ly = lwy - Math.cos(angle) * pupilInward;
            const rx = rwx - Math.sin(angle) * pupilInward;
            const ry = rwy + Math.cos(angle) * pupilInward;

            this.eyeL.setAttribute("cx", lx);
            this.eyeL.setAttribute("cy", ly);
            this.eyeR.setAttribute("cx", rx);
            this.eyeR.style.display = "block";
        } else {
            this.head.style.display = "none";
            this.eyeWhiteL.style.display = "none";
            this.eyeWhiteR.style.display = "none";
            this.eyeL.style.display = "none";
            this.eyeR.style.display = "none";
        }
    }

    grow() {
        this.eatCount++;
        this.constraints.forEach(c => c.length *= 1.02);
        this.baseRadii = this.baseRadii.map(r => r * 1.02);

        // 每吃 3 次，長出一個新節點
        if (this.eatCount % 3 === 0) {
            const lastPoint = this.points[this.points.length - 1];
            const secondLast = this.points[this.points.length - 2];
            
            const dx = lastPoint.x - secondLast.x;
            const dy = lastPoint.y - secondLast.y;
            const newPoint = new Point(lastPoint.x + dx, lastPoint.y + dy);
            this.points.push(newPoint);
            this.constraints.push(new Constraint(lastPoint, newPoint, this.nodeDist));
            // 增加新 DOM 節點
            const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
            circle.setAttribute("class", "planarian-body");
            circle.setAttribute("fill", this.color); // 保持色彩一致
            const newRadius = 2 * (1.02 ** this.eatCount);
            circle.setAttribute("r", newRadius);
            this.baseRadii.push(newRadius);
            this.bodyGroup.insertBefore(circle, this.head);
            this.bodySegments.push(circle);
        }
    }

    destroy() {
        this.bodyGroup.remove();
        this.eyeGroup.remove();
    }
}

// --- Audio Engine ---
class AudioEngine {
    constructor() {
        this.ctx = null;
        this.isStarted = false;
        // 更豐富的音階：C Major 9 (C, E, G, B, D)
        this.scale = [261.63, 329.63, 392.00, 493.88, 587.33, 659.25, 783.99];
    }

    start() {
        if (this.isStarted) return;
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.isStarted = true;
        this.playBGM();
    }

    playBGM() {
        const playTick = (step) => {
            const now = this.ctx.currentTime;
            
            // Bass line (every 1st beat)
            if (step % 3 === 0) {
                this.playNote(this.scale[0] / 2, now, 0.15, 1.5, 'sine');
            }

            // Arpeggio
            this.playNote(this.scale[step % this.scale.length], now, 0.08, 0.4);
            
            // Random Melody (sometimes)
            if (Math.random() > 0.7) {
                this.playNote(this.scale[Math.floor(Math.random() * this.scale.length)] * 2, now + 0.25, 0.05, 0.2);
            }
            
            setTimeout(() => playTick(step + 1), 500);
        };
        playTick(0);
    }

    playNote(freq, time, volume, duration, type = 'triangle') {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, time);
        gain.gain.setValueAtTime(volume, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(time);
        osc.stop(time + duration);
    }

    playCut() { 
        // 隨機高音，像碎掉的玻璃聲
        const freq = 1000 + Math.random() * 1000;
        this.playNote(freq, this.ctx.currentTime, 0.2, 0.1, 'square'); 
    }
    playEat() { 
        this.playNote(783.99, this.ctx.currentTime, 0.2, 0.3); // G5
        this.playNote(1046.50, this.ctx.currentTime + 0.1, 0.1, 0.2); // C6
    }
    playClean() {
        for(let i=0; i<8; i++) {
            this.playNote(400 + Math.random() * 800, this.ctx.currentTime + i * 0.05, 0.05, 0.1, 'sine');
        }
    }
    playTease() { this.playNote(880 + Math.random() * 400, this.ctx.currentTime, 0.1, 0.1, 'sine'); }
    playBell() {
        const now = this.ctx.currentTime;
        this.playNote(1567.98, now, 0.2, 0.5); // G6
        this.playNote(1318.51, now + 0.1, 0.1, 0.4); // E6
    }
}

const audio = new AudioEngine();

// --- Initialization & Loop ---
function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.setAttribute("viewBox", `0 0 ${width} ${height}`);
}

function init() {
    resize();
    window.addEventListener('resize', resize);

    // Try to load saved state
    if (!loadState()) {
        // Initial planarians if no save found
        for (let i = 0; i < 3; i++) {
            planarians.push(new Planarian(width / 2 + (Math.random() - 0.5) * 200, height / 2 + (Math.random() - 0.5) * 200));
        }
    }

    // Audio start on first click
    window.addEventListener('pointerdown', () => audio.start(), { once: true });

    requestAnimationFrame(loop);
}

let saveTimer = 0;
function loop() {
    // Water slowly gets dirty
    waterPurity = Math.max(0, waterPurity - 0.01);
    dirtyLayer.setAttribute("opacity", (1 - waterPurity / 100) * 0.3);

    // Save state every 5 seconds (300 frames)
    saveTimer++;
    if (saveTimer > 300) {
        saveState();
        saveTimer = 0;
    }

    // Throttled Interaction logic (v0.03)
    if (isPointerDown) {
        if (currentMode === 'cut') {
            checkCut(mouseX, mouseY);
        } else if (currentMode === 'tease') {
            checkTease(mouseX, mouseY);
        }
    }

    planarians.forEach(p => p.update());
    requestAnimationFrame(loop);
}

// --- Interaction ---
window.addEventListener('pointermove', (e) => {
    const rect = canvas.getBoundingClientRect();
    mouseX = e.clientX - rect.left;
    mouseY = e.clientY - rect.top;
});

canvas.addEventListener('pointerdown', (e) => {
    isPointerDown = true;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    mouseX = x;
    mouseY = y;

    if (currentMode === 'observe') {
        createRipple(x, y);
    } else if (currentMode === 'feed') {
        createFood(x, y);
    } else if (currentMode === 'tease') {
        checkTease(x, y);
    } else if (currentMode === 'bell') {
        triggerBell(x, y);
    } else if (currentMode === 'clean') {
        createBubbles();
    }
});

window.addEventListener('pointerup', () => isPointerDown = false);
window.addEventListener('pointercancel', () => isPointerDown = false);

function checkTease(x, y) {
    planarians.forEach(p => {
        p.points.forEach(point => {
            const d = distance({x, y}, point);
            if (d < 50) {
                const dx = point.x - x;
                const dy = point.y - y;
                const angle = Math.atan2(dy, dx);
                point.applyForce(Math.cos(angle) * 5, Math.sin(angle) * 5);
                audio.playTease();
            }
        });
    });
}

function triggerBell(x, y) {
    audio.playBell();
    window.bellTarget = {x, y};
    createRipple(x, y);
    
    // Bell lasts for 3 seconds
    setTimeout(() => {
        window.bellTarget = null;
    }, 3000);
}

function createRipple(x, y) {
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", x);
    circle.setAttribute("cy", y);
    circle.setAttribute("r", "5");
    circle.setAttribute("class", "ripple");
    fxLayer.appendChild(circle);

    let r = 5;
    let opacity = 1;
    function anim() {
        r += 2;
        opacity -= 0.02;
        circle.setAttribute("r", r);
        circle.style.opacity = opacity;
        if (opacity > 0) requestAnimationFrame(anim);
        else circle.remove();
    }
    anim();
}

function createFood(x, y) {
    const heart = document.createElementNS("http://www.w3.org/2000/svg", "path");
    heart.setAttribute("d", "M 10,30 A 20,20 0,0,1 50,30 A 20,20 0,0,1 90,30 Q 90,60 50,90 Q 10,60 10,30 z");
    heart.setAttribute("transform", `translate(${x - 10}, ${y - 10}) scale(0.2)`);
    heart.setAttribute("class", "heart-food");
    foodLayer.appendChild(heart);
    foods.push({x, y});
}

function checkCut(x, y) {
    createSparkle(x, y);
    // Use a while loop to safely remove items during iteration
    let i = planarians.length;
    while (i--) {
        const p = planarians[i];
        for (let j = 0; j < p.points.length - 1; j++) {
            const p1 = p.points[j];
            const p2 = p.points[j+1];
            const d = distToSegment({x, y}, p1, p2);
            // Increased radius for easier cutting (20px)
            // Now allows splitting if total nodes >= 6
            if (d < 20 && p.points.length >= 6) {
                splitPlanarian(i, j);
                return; // Cut one at a time for stability
            }
        }
    }
}

function createSparkle(x, y) {
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", x + (Math.random() - 0.5) * 10);
    circle.setAttribute("cy", y + (Math.random() - 0.5) * 10);
    circle.setAttribute("r", 1 + Math.random() * 3);
    circle.setAttribute("fill", "#ff8fa3");
    circle.setAttribute("filter", "none"); // Don't gooey the sparkles
    fxLayer.appendChild(circle);

    let opacity = 1;
    function anim() {
        opacity -= 0.05;
        circle.style.opacity = opacity;
        if (opacity > 0) requestAnimationFrame(anim);
        else circle.remove();
    }
    anim();
}

function distToSegment(p, v, w) {
    const l2 = (v.x - w.x)**2 + (v.y - w.y)**2;
    if (l2 == 0) return distance(p, v);
    let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
    t = Math.max(0, Math.min(1, t));
    return distance(p, { x: v.x + t * (w.x - v.x), y: v.y + t * (w.y - v.y) });
}

function splitPlanarian(idx, splitIdx) {
    // Population control: max 20 planarians
    if (planarians.length >= 20) return;

    audio.playCut();
    const p = planarians[idx];
    
    // Get the points for each half
    const points1 = p.points.slice(0, splitIdx + 1);
    const points2 = p.points.slice(splitIdx + 1);

    if (points1.length < 3 || points2.length < 3) return;

    // IMPORTANT: Reset velocities to prevent "zoom-off"
    [...points1, ...points2].forEach(pt => {
        pt.oldX = pt.x;
        pt.oldY = pt.y;
    });

    const nodeDist = p.nodeDist;
    const color = p.color; // 繼承色彩
    p.destroy();
    planarians.splice(idx, 1);

    // Part 1 (Head)
    const p1 = new Planarian(0, 0, points1.length, nodeDist, points1, color);
    p1.hasHead = true;
    p1.stunTimer = 60; // Stun for 1 second
    planarians.push(p1);

    // Part 2 (Tail -> Needs regeneration)
    const p2 = new Planarian(0, 0, points2.length, nodeDist, points2, color);
    p2.hasHead = false;
    p2.stunTimer = 60; // Stun for 1 second
    planarians.push(p2);
}

function createBubbles() {
    audio.playClean();
    waterPurity = 100;
    
    planarians.forEach(p => {
        p.stunTimer = 60;
        p.points.forEach(pt => {
            pt.applyForce((Math.random() - 0.5) * 30, 40 + Math.random() * 40);
        });
        p.angle += Math.PI;
    });

    for (let i = 0; i < 20; i++) {
        const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        const x = Math.random() * width;
        const r = 5 + Math.random() * 15;
        circle.setAttribute("cx", x);
        circle.setAttribute("cy", height + 50);
        circle.setAttribute("r", r);
        circle.setAttribute("fill", "white");
        circle.setAttribute("opacity", "0.5");
        fxLayer.appendChild(circle);

        let curY = height + 50;
        let speed = 3 + Math.random() * 5;
        function anim() {
            curY -= speed;
            circle.setAttribute("cy", curY);
            if (curY > -50) requestAnimationFrame(anim);
            else circle.remove();
        }
        anim();
    }
}

// --- UI Logic ---
document.querySelectorAll('.controls button').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.controls button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentMode = btn.id.replace('mode-', '');
    });
});

init();

function saveState() {
    const data = planarians.map(p => ({
        points: p.points.map(pt => ({x: pt.x, y: pt.y})),
        hasHead: p.hasHead,
        color: p.color,
        nodeDist: p.nodeDist,
        eatCount: p.eatCount
    }));
    localStorage.setItem('pinky_planarian_state', JSON.stringify({
        planarians: data,
        waterPurity: waterPurity
    }));
}

function loadState() {
    try {
        const saved = localStorage.getItem('pinky_planarian_state');
        if (!saved) return false;
        const data = JSON.parse(saved);
        
        waterPurity = data.waterPurity || 100;
        
        data.planarians.forEach(d => {
            const points = d.points.map(pt => new Point(pt.x, pt.y));
            const p = new Planarian(0, 0, points.length, d.nodeDist, points, d.color);
            p.hasHead = d.hasHead;
            p.eatCount = d.eatCount || 0;
            planarians.push(p);
        });
        return true;
    } catch (e) {
        console.error("Failed to load state", e);
        return false;
    }
}
