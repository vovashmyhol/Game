// Constants
const COLORS = [
    '#ff2d55', '#34c759', '#ff9500', '#007aff', '#af52de', 
    '#5ac8fa', '#ffcc00', '#ff3b30', '#5856d6', '#ff2d55'
];

// State
let players = [];
let territories = [];
let gameState = 'idle'; // idle, countdown, aiming, playing, result
let totalBet = 0;
let gameCount = parseInt(localStorage.getItem('arena_game_count')) || 0;
let modalTimer = null;

// DOM Elements
const canvas = document.getElementById('arena-canvas');
const ctx = canvas.getContext('2d');
const playerNameInput = document.getElementById('player-name');
const playerBetInput = document.getElementById('player-bet');
const addPlayerBtn = document.getElementById('add-player-btn');
const playBtn = document.getElementById('play-btn');
const playersList = document.getElementById('players-list');
const totalPoolValue = document.getElementById('total-pool-value');
const currentPlayerCount = document.getElementById('current-player-count');
const countdownOverlay = document.getElementById('countdown-overlay');
const countdownNumber = document.getElementById('countdown-number');
const gameCountDisplay = document.getElementById('game-count-display');
const waitingState = document.getElementById('waiting-state');
const winnerModal = document.getElementById('winner-modal');
const winnerNameDisplay = document.getElementById('winner-name-display');
const closeModalBtn = document.getElementById('close-modal-btn');

// Canvas Setup
function resizeCanvas() {
    const container = canvas.parentElement;
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;
    generateTerritories(); 
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// Player Management
addPlayerBtn.addEventListener('click', () => {
    const name = playerNameInput.value.trim();
    const bet = parseFloat(playerBetInput.value);
    if (!name || isNaN(bet) || bet <= 0) return;

    players.push({
        id: Date.now(),
        name,
        bet,
        color: COLORS[players.length % COLORS.length]
    });

    playerNameInput.value = '';
    playerBetInput.value = '';
    updateUI();
    generateTerritories();
});

function removePlayer(id) {
    players = players.filter(p => p.id !== id);
    updateUI();
    generateTerritories();
}

function updateUI() {
    playersList.innerHTML = '';
    totalBet = 0;

    players.forEach(p => {
        totalBet += p.bet;
        const item = document.createElement('div');
        item.className = 'player-item';
        item.style.borderLeftColor = p.color;
        item.innerHTML = `
            <span>${p.name} (${p.bet})</span>
            <button class="remove-player" onclick="removePlayer(${p.id})">×</button>
        `;
        playersList.appendChild(item);
    });

    totalPoolValue.textContent = totalBet.toFixed(2);
    currentPlayerCount.textContent = players.length;
    gameCountDisplay.textContent = `Сыграно игр: ${gameCount}`;
    
    // Play button state
    playBtn.disabled = players.length < 2;
    if (players.length < 2) playBtn.classList.add('disabled');
    else playBtn.classList.remove('disabled');

    // Waiting state visibility
    if (players.length === 0) waitingState.classList.remove('hidden');
    else waitingState.classList.add('hidden');
}

// --- Geometry ---

function getPolygonArea(points) {
    let area = 0;
    for (let i = 0; i < points.length; i++) {
        let j = (i + 1) % points.length;
        area += points[i].x * points[j].y;
        area -= points[j].x * points[i].y;
    }
    return Math.abs(area) / 2;
}

function clipPolygon(points, lineNormal, lineDistance) {
    const result = [];
    for (let i = 0; i < points.length; i++) {
        const p1 = points[i];
        const p2 = points[(i + 1) % points.length];
        const d1 = p1.x * lineNormal.x + p1.y * lineNormal.y - lineDistance;
        const d2 = p2.x * lineNormal.x + p2.y * lineNormal.y - lineDistance;
        if (d1 <= 0) result.push(p1);
        if ((d1 > 0 && d2 <= 0) || (d1 <= 0 && d2 > 0)) {
            const t = d1 / (d1 - d2);
            result.push({ x: p1.x + t * (p2.x - p1.x), y: p1.y + t * (p2.y - p1.y) });
        }
    }
    return result;
}

function generateTerritories() {
    const rect = [
        { x: 0, y: 0 },
        { x: canvas.width, y: 0 },
        { x: canvas.width, y: canvas.height },
        { x: 0, y: canvas.height }
    ];

    if (players.length === 0) {
        territories = [{ poly: rect, player: { name: '', color: '#1c1c1e' } }];
        return;
    }

    const sortedPlayers = [...players].sort((a, b) => b.bet - a.bet);
    let currentGroups = [{ poly: rect, players: sortedPlayers }];
    const final = [];

    while (currentGroups.length > 0) {
        const { poly, players: group } = currentGroups.shift();
        if (group.length === 1) {
            final.push({ poly, player: group[0] });
            continue;
        }

        const mid = Math.ceil(group.length / 2);
        const g1 = group.slice(0, mid);
        const g2 = group.slice(mid);
        const sum1 = g1.reduce((s, p) => s + p.bet, 0);
        const sum2 = g2.reduce((s, p) => s + p.bet, 0);
        const ratio = sum1 / (sum1 + sum2);

        // Find bounding box to determine longest axis
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        poly.forEach(p => {
            minX = Math.min(minX, p.x);
            maxX = Math.max(maxX, p.x);
            minY = Math.min(minY, p.y);
            maxY = Math.max(maxY, p.y);
        });
        const width = maxX - minX;
        const height = maxY - minY;

        // Base angle: cut perpendicular to the longest axis
        // If width > height, normal is horizontal (angle 0) -> vertical cut
        // If height > width, normal is vertical (angle PI/2) -> horizontal cut
        const baseAngle = (width > height) ? 0 : Math.PI / 2;

        // Add skew to make it diagonal, but sometimes keep it straight
        // Max skew is about 35 degrees (0.6 radians). We limit skew if aspect ratio is extreme to avoid sharp tips.
        const aspectRatio = Math.max(width / height, height / width);
        const maxSkew = (aspectRatio > 3) ? 0.1 : 0.6; 
        
        // 30% chance for a straight cut, otherwise angled
        const skew = (Math.random() < 0.3) ? 0 : (Math.random() * maxSkew * 2 - maxSkew);
        
        const angle = baseAngle + skew;
        const normal = { x: Math.cos(angle), y: Math.sin(angle) };

        let minProj = Infinity, maxProj = -Infinity;
        poly.forEach(p => {
            const proj = p.x * normal.x + p.y * normal.y;
            minProj = Math.min(minProj, proj);
            maxProj = Math.max(maxProj, proj);
        });

        let low = minProj, high = maxProj, bestDist = low;
        const totalA = getPolygonArea(poly);
        for (let i = 0; i < 20; i++) {
            let midD = (low + high) / 2;
            if (getPolygonArea(clipPolygon(poly, normal, midD)) < totalA * ratio) low = midD;
            else high = midD;
            bestDist = midD;
        }

        currentGroups.push({ poly: clipPolygon(poly, normal, bestDist), players: g1 });
        currentGroups.push({ poly: clipPolygon(poly, { x: -normal.x, y: -normal.y }, -bestDist), players: g2 });
    }
    territories = final;
}

// --- Physics ---

class Puck {
    constructor() {
        this.radius = 15;
        this.x = 0;
        this.y = 0;
        this.vx = 0;
        this.vy = 0;
        this.stopped = false;
        // Arrow aiming
        this.aiming = false;
        this.arrowAngle = 0;       // current displayed angle
        this.arrowTargetAngle = 0; // final angle = launch direction
        this.arrowSpin = 0;        // angular velocity
        this.arrowFriction = 0.96;
    }

    reset() {
        // Random position away from edges
        const pad = 40;
        this.x = pad + Math.random() * (canvas.width - pad * 2);
        this.y = pad + Math.random() * (canvas.height - pad * 2);
        this.stopped = false;
        this.vx = 0;
        this.vy = 0;

        // Pre-decide launch direction
        this.arrowTargetAngle = Math.random() * Math.PI * 2;
        // Start arrow spinning fast from random angle
        this.arrowAngle = Math.random() * Math.PI * 2;
        // Start arrow spinning fast — ~2-3 full rotations before stopping
        // With friction 0.96, total angle = spin0 / (1-0.96) = spin0 * 25
        // For ~3 rotations (18.85 rad): spin0 ≈ 0.75
        this.arrowSpin = (Math.random() > 0.5 ? 1 : -1) * (0.55 + Math.random() * 0.25);
        this.aiming = true;
    }

    updateArrow() {
        if (!this.aiming) return;

        // Compute shortest angular distance to target
        let diff = this.arrowTargetAngle - this.arrowAngle;
        // Normalise diff to [-PI, PI]
        while (diff > Math.PI)  diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;

        // Apply spin with friction
        this.arrowSpin *= this.arrowFriction;

        // Once spin is very slow, snap to target and launch
        if (Math.abs(this.arrowSpin) < 0.004) {
            this.aiming = false;

            // Launch puck in the direction the arrow actually stopped at
            const speed = 40 + Math.random() * 15;
            this.vx = Math.cos(this.arrowAngle) * speed;
            this.vy = Math.sin(this.arrowAngle) * speed;
            gameState = 'playing';
            return;
        }

        this.arrowAngle += this.arrowSpin;
    }

    update() {
        if (this.stopped) return;
        this.x += this.vx;
        this.y += this.vy;

        if (this.x - this.radius < 0 || this.x + this.radius > canvas.width) {
            this.vx *= -1;
            this.x = Math.max(this.radius, Math.min(canvas.width - this.radius, this.x));
        }
        if (this.y - this.radius < 0 || this.y + this.radius > canvas.height) {
            this.vy *= -1;
            this.y = Math.max(this.radius, Math.min(canvas.height - this.radius, this.y));
        }

        this.vx *= 0.993;
        this.vy *= 0.993;

        if (Math.abs(this.vx) < 0.05 && Math.abs(this.vy) < 0.05) {
            this.vx = 0; this.vy = 0;
            this.stopped = true;
            setTimeout(showWinner, 500);
        }
    }

    drawArrow() {
        const arrowLen = this.radius * 1.4;
        const tipX = this.x + Math.cos(this.arrowAngle) * (this.radius + arrowLen);
        const tipY = this.y + Math.sin(this.arrowAngle) * (this.radius + arrowLen);

        ctx.save();
        ctx.shadowBlur = 10;
        ctx.shadowColor = '#fff';
        ctx.strokeStyle = '#fff';
        ctx.fillStyle = '#fff';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';

        // Stem
        ctx.beginPath();
        ctx.moveTo(
            this.x + Math.cos(this.arrowAngle) * this.radius,
            this.y + Math.sin(this.arrowAngle) * this.radius
        );
        ctx.lineTo(tipX, tipY);
        ctx.stroke();

        // Arrowhead
        const headLen = 10;
        const headAngle = 0.45;
        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(
            tipX - headLen * Math.cos(this.arrowAngle - headAngle),
            tipY - headLen * Math.sin(this.arrowAngle - headAngle)
        );
        ctx.lineTo(
            tipX - headLen * Math.cos(this.arrowAngle + headAngle),
            tipY - headLen * Math.sin(this.arrowAngle + headAngle)
        );
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }

    draw() {
        ctx.save();
        ctx.shadowBlur = 25;
        ctx.shadowColor = '#fff';
        
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius + 5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.2)';
        ctx.fill();

        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();

        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius * 0.5, 0, Math.PI * 2);
        ctx.strokeStyle = '#007aff';
        ctx.lineWidth = 4;
        ctx.stroke();
        ctx.restore();
    }
}

const puck = new Puck();

// --- Main Loop ---

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    territories.forEach(t => {
        if (!t.poly.length) return;
        ctx.beginPath();
        ctx.moveTo(t.poly[0].x, t.poly[0].y);
        for (let i = 1; i < t.poly.length; i++) ctx.lineTo(t.poly[i].x, t.poly[i].y);
        ctx.closePath();
        
        const centroid = getCentroid(t.poly);
        const grad = ctx.createRadialGradient(centroid.x, centroid.y, 5, centroid.x, centroid.y, canvas.width);
        grad.addColorStop(0, t.player.color);
        grad.addColorStop(1, adjustColor(t.player.color, -50));
        ctx.fillStyle = grad;
        ctx.fill();
        
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.lineWidth = 3;
        ctx.stroke();

        if (t.player.name) {
            const polyArea = getPolygonArea(t.poly);
            // Smaller avatars: use /5.5 instead of /3.5, max 50
            const calculatedRadius = Math.sqrt(polyArea) / 5.5;
            
            // Clamp radius to fit inside the polygon:
            // find the min distance from centroid to any polygon edge
            let minEdgeDist = Infinity;
            for (let i = 0; i < t.poly.length; i++) {
                const a = t.poly[i];
                const b = t.poly[(i + 1) % t.poly.length];
                const dx = b.x - a.x, dy = b.y - a.y;
                const len = Math.sqrt(dx*dx + dy*dy);
                if (len === 0) continue;
                const dist = Math.abs(dy * centroid.x - dx * centroid.y + b.x * a.y - b.y * a.x) / len;
                minEdgeDist = Math.min(minEdgeDist, dist);
            }
            // Keep avatar fully inside: max radius = 80% of min edge distance
            const r = Math.max(10, Math.min(50, calculatedRadius, minEdgeDist * 0.8));

            ctx.save();
            ctx.translate(centroid.x, centroid.y);
            
            ctx.beginPath();
            ctx.arc(0, 0, r, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(255,255,255,0.2)';
            ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.5)';
            ctx.lineWidth = Math.max(1, r / 15);
            ctx.stroke();

            ctx.fillStyle = '#fff';
            const fontSize = r * 0.9;
            ctx.font = `bold ${fontSize}px Inter`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(t.player.name.charAt(0).toUpperCase(), 0, 2);
            
            ctx.restore();
        }
    });

    if (gameState === 'aiming') {
        puck.updateArrow();
        puck.draw();
        puck.drawArrow();
    } else if (gameState === 'playing') {
        puck.update();
        puck.draw();
    }
    requestAnimationFrame(draw);
}

function getCentroid(points) {
    let area = 0;
    let cx = 0, cy = 0;
    for (let i = 0; i < points.length; i++) {
        const j = (i + 1) % points.length;
        const cross = points[i].x * points[j].y - points[j].x * points[i].y;
        area += cross;
        cx += (points[i].x + points[j].x) * cross;
        cy += (points[i].y + points[j].y) * cross;
    }
    area /= 2;
    cx /= (6 * area);
    cy /= (6 * area);
    return { x: cx, y: cy };
}

function adjustColor(hex, amount) {
    let usePound = hex[0] === '#';
    hex = usePound ? hex.slice(1) : hex;
    let num = parseInt(hex, 16);
    let r = Math.max(0, Math.min(255, (num >> 16) + amount));
    let g = Math.max(0, Math.min(255, ((num >> 8) & 0x00FF) + amount));
    let b = Math.max(0, Math.min(255, (num & 0x0000FF) + amount));
    return (usePound ? "#" : "") + (b | (g << 8) | (r << 16)).toString(16).padStart(6, '0');
}

// --- Flow ---

playBtn.addEventListener('click', () => {
    if (gameState !== 'idle' && gameState !== 'result') return;
    startCountdown();
});

function startCountdown() {
    gameState = 'countdown';
    countdownOverlay.classList.remove('hidden');
    winnerModal.classList.add('hidden');
    let count = 3;
    countdownNumber.textContent = count;
    const interval = setInterval(() => {
        count--;
        if (count > 0) countdownNumber.textContent = count;
        else {
            clearInterval(interval);
            countdownOverlay.classList.add('hidden');
            gameState = 'aiming';
            puck.reset();
        }
    }, 1000);
}

function showWinner() {
    gameState = 'result';
    let winner = null;
    territories.forEach(t => {
        if (isPointInPoly({ x: puck.x, y: puck.y }, t.poly)) winner = t.player;
    });

    if (winner) {
        winnerNameDisplay.textContent = winner.name;
        winnerModal.classList.remove('hidden');
        
        // Confetti!
        confetti({
            particleCount: 150,
            spread: 70,
            origin: { y: 0.6 },
            colors: [winner.color, '#ffffff', '#007aff']
        });

        // Increment count
        gameCount++;
        localStorage.setItem('arena_game_count', gameCount);
        updateUI();

        // Auto-close after 5 seconds
        if (modalTimer) clearTimeout(modalTimer);
        modalTimer = setTimeout(closeWinnerModal, 5000);
    }
}

function closeWinnerModal() {
    winnerModal.classList.add('hidden');
    gameState = 'idle';
}

closeModalBtn.addEventListener('click', closeWinnerModal);

function isPointInPoly(p, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        if (((poly[i].y > p.y) !== (poly[j].y > p.y)) && (p.x < (poly[j].x - poly[i].x) * (p.y - poly[i].y) / (poly[j].y - poly[i].y) + poly[i].x)) inside = !inside;
    }
    return inside;
}

window.removePlayer = removePlayer;

// Disable right-click context menu
document.addEventListener('contextmenu', e => e.preventDefault());

// Telegram Mini App — prevent swipe-down close gesture
// We block touchmove only when the user is NOT scrolling a scrollable element
document.addEventListener('touchmove', (e) => {
    // Allow scroll inside elements that can actually scroll
    let el = e.target;
    let canScroll = false;
    while (el && el !== document.body) {
        const style = window.getComputedStyle(el);
        const overflow = style.overflowY;
        const isScrollable = (overflow === 'auto' || overflow === 'scroll') && el.scrollHeight > el.clientHeight;
        if (isScrollable) { canScroll = true; break; }
        el = el.parentElement;
    }
    if (!canScroll) e.preventDefault();
}, { passive: false });

// Also tell Telegram SDK to disable closing if available
if (window.Telegram?.WebApp) {
    Telegram.WebApp.disableClosingConfirmation?.();
    Telegram.WebApp.enableClosingConfirmation?.();
    // Expand to full height so there's less chance of accidental close
    Telegram.WebApp.expand();
}

requestAnimationFrame(draw);
updateUI();