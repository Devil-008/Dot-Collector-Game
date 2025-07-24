const socket = io();
let currentRoom = null;
let playerId = null;
let isHost = false;
let gameStarted = false;
let players = new Map();
let dots = [];
let myPlayer = null; // This will store the current player's object
let gameTimerInterval = null;
let specialDotTimerInterval = null;

const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");


// Socket event listeners
socket.on("roomCreated", (data) => {
  currentRoom = data.roomId;
  playerId = data.playerId;
  isHost = data.isHost;
  showLobby();
  showMessage("Room created successfully!", "success");
});

socket.on("roomJoined", (data) => {
  currentRoom = data.roomId;
  playerId = data.playerId;
  isHost = data.isHost;
  showLobby();
  showMessage("Joined room successfully!", "success");
});

socket.on("playersUpdated", (playersList) => {
  players.clear();
  playersList.forEach((player) => {
    players.set(player.id, player);
    if (player.id === playerId) {
      myPlayer = player;
    }
  });
  updatePlayersDisplay();
});

socket.on("gameStarted", (data) => {
  gameStarted = true;
  players.clear();
  data.players.forEach((player) => {
    players.set(player.id, player);
    if (player.id === playerId) {
      myPlayer = player;
    }
  });
  dots = data.dots;
  showGame();
  startGameTimer(data.gameTime); // Start the main game countdown
  gameLoop();
});

socket.on("playerMoved", (data) => {
  const player = players.get(data.playerId);
  if (player) {
    player.x = data.x;
    player.y = data.y;
  }
});

socket.on("dotCollected", (data) => {
  // Find the dot by ID instead of index, as index might change due to other collections
  // The server sends the original index, but it's safer to find by a unique ID if possible.
  // For now, assuming dotIndex from server is reliable *if no other client collected a dot simultaneously*.
  // A more robust way would be for the server to send the ID of the collected dot.
  // Let's assume for now the server sends the ID of the collected dot as `data.collectedDotId`
  const collectedDotIndex = dots.findIndex(dot => dot.id === data.dotId); // Assuming server sends dot.id
  if (collectedDotIndex !== -1) {
      dots.splice(collectedDotIndex, 1);
  }
  dots.push(data.newDot);
});

socket.on("scoresUpdated", (playersList) => {
  playersList.forEach((playerData) => {
    const player = players.get(playerData.id);
    if (player) {
      player.score = playerData.score;
    }
  });
  updatePlayersDisplay();
});

// Listen for when a special dot is added by the server
socket.on("specialDotAdded", (specialDot) => {
    dots.push(specialDot); // Add the special dot to the local array
    startSpecialDotTimer(10); // Reset the special dot timer display
});

// Listen for when the game ends
socket.on("gameEnded", (results) => {
  gameStarted = false;
  stopTimers(); // Stop all client-side timers
  showLobby();
  displayWinnerModal(results); // Show the winner modal
});

socket.on("roomClosed", () => {
  showMessage("Room was closed by host", "error");
  stopTimers();
  backToMenu();
});

socket.on("error", (message) => {
  showMessage(message, "error");
});

// UI Functions
function createRoom() {
  const playerName = document.getElementById("playerName").value.trim();
  if (!playerName) {
    showMessage("Please enter your name", "error");
    return;
  }
  socket.emit("createRoom", playerName);
}

function showJoinRoom() {
  document.getElementById("joinRoomDiv").style.display = "block";
}

function hideJoinRoom() {
  document.getElementById("joinRoomDiv").style.display = "none";
}

function joinRoom() {
  const playerName = document.getElementById("playerName").value.trim();
  const roomId = document
    .getElementById("roomIdInput")
    .value.trim()
    .toUpperCase();

  if (!playerName) {
    showMessage("Please enter your name", "error");
    return;
  }

  if (!roomId) {
    showMessage("Please enter room ID", "error");
    return;
  }

  socket.emit("joinRoom", { roomId, playerName });
}

function startGame() {
  socket.emit("startGame");
}

function endGame() {
  socket.emit("endGame");
}

function leaveRoom() {
  socket.emit("leaveRoom");
  backToMenu();
}

function showLobby() {
  document.getElementById("mainMenu").style.display = "none";
  document.getElementById("gameLobby").style.display = "block";
  document.getElementById("gameArea").style.display = "none";

  document.getElementById("roomIdDisplay").textContent = currentRoom;
  document.getElementById("hostStatus").textContent = isHost
    ? "You are the host"
    : "Waiting for host to start...";
  document.getElementById("hostControls").style.display = isHost
    ? "block"
    : "none";
}

function showGame() {
  document.getElementById("mainMenu").style.display = "none";
  document.getElementById("gameLobby").style.display = "none";
  document.getElementById("gameArea").style.display = "block";

  document.getElementById("gameRoomId").textContent = currentRoom;
  document.getElementById("gameHostControls").style.display = isHost
    ? "block"
    : "none";
}

function backToMenu() {
  document.getElementById("mainMenu").style.display = "block";
  document.getElementById("gameLobby").style.display = "none";
  document.getElementById("gameArea").style.display = "none";

  currentRoom = null;
  playerId = null;
  isHost = false;
  gameStarted = false;
  players.clear();
  dots = []; // Clear dots on returning to menu
  stopTimers(); // Ensure timers are stopped
  dots = [];
}

function updatePlayersDisplay() {
  const lobbyList = document.getElementById("playersList");
  const gameList = document.getElementById("gamePlayersList");

  let html = "";
  players.forEach((player) => {
    html += `
                <div class="player-card" style="border-left: 4px solid ${
                  player.color
                }">
                    <strong>${player.name}</strong>
                    ${player.isHost ? " (Host)" : ""}
                    <br>Score: ${player.score}
                </div>
            `;
  });

  if (lobbyList) lobbyList.innerHTML = html;
  if (gameList) gameList.innerHTML = html;
}

function showMessage(message, type) {
  const messagesDiv = document.getElementById("messages");
  const messageEl = document.createElement("div");
  messageEl.className = type;
  messageEl.textContent = message;
  messagesDiv.appendChild(messageEl);

  setTimeout(() => {
    messageEl.remove();
  }, 5000);
}

// Winner Modal Functions
function displayWinnerModal(results) {
    const modal = document.getElementById("winnerModal");
    const winnerMessageEl = document.getElementById("winnerMessage");
    const finalScoresEl = document.getElementById("finalScores");

    winnerMessageEl.textContent = results.resultMessage;

    let scoresHtml = "<h3>Final Scores:</h3><ul>";
    // Sort scores descending for display
    results.finalScores.sort((a, b) => b.score - a.score);
    results.finalScores.forEach(player => {
        // Check if this player is among the winners based on the resultMessage or max score
        // A simple check: if their score is the highest.
        const isWinner = player.score === results.finalScores[0].score;
        scoresHtml += `
            <li class="score-item ${isWinner ? 'winner-score' : ''}">
                <span>${player.name}</span>
                <span>${player.score}</span>
            </li>
        `;
    });
    scoresHtml += "</ul>";
    finalScoresEl.innerHTML = scoresHtml;

    modal.style.display = "block";
}

function closeWinnerModal() {
    document.getElementById("winnerModal").style.display = "none";
    // showLobby() is already called by gameEnded, so this just hides the modal.
}

// Timer Functions
function startGameTimer(durationInSeconds) {
    let timeLeft = durationInSeconds;
    const timerEl = document.getElementById("gameTimer");
    if (!timerEl) return;
    timerEl.textContent = timeLeft;
    timerEl.classList.remove('warning');

    if (gameTimerInterval) clearInterval(gameTimerInterval);
    gameTimerInterval = setInterval(() => {
        timeLeft--;
        timerEl.textContent = timeLeft;
        if (timeLeft <= 10) timerEl.classList.add('warning');
        if (timeLeft <= 0) {
            clearInterval(gameTimerInterval);
            // Game end is triggered by the server
        }
    }, 1000);
}

function startSpecialDotTimer(durationInSeconds) {
    let timeLeft = durationInSeconds;
    const timerEl = document.getElementById("specialDotTimer");
    if (!timerEl) return;
    timerEl.textContent = timeLeft;

    if (specialDotTimerInterval) clearInterval(specialDotTimerInterval);
    specialDotTimerInterval = setInterval(() => {
        timeLeft--;
        timerEl.textContent = timeLeft;
        if (timeLeft <= 0) {
            clearInterval(specialDotTimerInterval);
            // Server will send a new special dot, which will call this function again
        }
    }, 1000);
}

function stopTimers() {
    if (gameTimerInterval) {
        clearInterval(gameTimerInterval);
        gameTimerInterval = null;
    }
    if (specialDotTimerInterval) {
        clearInterval(specialDotTimerInterval);
        specialDotTimerInterval = null;
    }
    // Reset timer displays
    const gameTimerEl = document.getElementById("gameTimer");
    if (gameTimerEl) {
        gameTimerEl.textContent = '60'; // Default start time
        gameTimerEl.classList.remove('warning');
    }
    const specialDotTimerEl = document.getElementById("specialDotTimer");
    if (specialDotTimerEl) specialDotTimerEl.textContent = '10'; // Default interval
}

// Game Logic
let keys = {};

document.addEventListener("keydown", (e) => {
  keys[e.key] = true;
});

document.addEventListener("keyup", (e) => {
  keys[e.key] = false;
});

function gameLoop() {
  if (!gameStarted || !myPlayer) return;
  if (!players.has(playerId)) myPlayer = null; // Ensure myPlayer is still valid

  // Handle movement
  let moved = false;
  const speed = 3;

  if (keys["ArrowUp"] || keys["w"] || keys["W"]) {
    myPlayer.y = Math.max(15, myPlayer.y - speed);
    moved = true;
  }
  if (keys["ArrowDown"] || keys["s"] || keys["S"]) {
    myPlayer.y = Math.min(585, myPlayer.y + speed);
    moved = true;
  }
  if (keys["ArrowLeft"] || keys["a"] || keys["A"]) {
    myPlayer.x = Math.max(15, myPlayer.x - speed);
    moved = true;
  }
  if (keys["ArrowRight"] || keys["d"] || keys["D"]) {
    myPlayer.x = Math.min(785, myPlayer.x + speed);
    moved = true;
  }

  if (moved) {
    socket.emit("playerMove", { x: myPlayer.x, y: myPlayer.y });
  }

  // Render game
  render();

  if (gameStarted) {
    requestAnimationFrame(gameLoop);
  }
}

function render() {
  // Clear canvas
  ctx.fillStyle = "#f0f0f0";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Draw dots
  dots.forEach(dot => {
    if (dot.type === 'special') {
      ctx.fillStyle = "#ffd700"; // Yellow for special dots
      ctx.shadowBlur = 10;
      ctx.shadowColor = "#ffd700";
    } else {
      ctx.fillStyle = "#ff6b6b"; // Red for normal dots
    }
    ctx.beginPath();
    ctx.arc(dot.x, dot.y, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0; // Reset shadow for other elements
  });

  // Draw players
  players.forEach((player) => {
    ctx.fillStyle = player.color;
    ctx.beginPath();
    ctx.arc(player.x, player.y, 15, 0, Math.PI * 2);
    ctx.fill();

    // Draw player name
    ctx.fillStyle = "#000";
    ctx.font = "12px Arial";
    ctx.textAlign = "center";
    ctx.fillText(player.name, player.x, player.y - 20);
  });
}

// Instructions
document.addEventListener("DOMContentLoaded", () => {
  showMessage(
    "Use WASD or Arrow Keys to move around and collect red dots!",
    "success"
  );
  // Initialize timers display
  if (document.getElementById("gameTimer")) document.getElementById("gameTimer").textContent = '60';
  if (document.getElementById("specialDotTimer")) document.getElementById("specialDotTimer").textContent = '10';
});
