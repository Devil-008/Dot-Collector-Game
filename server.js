const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const path = require("path");
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// Serve static files
app.use(express.static(path.join(__dirname, "public")));

// Add a test route
app.get("/", (req, res) => {
  console.log("Root route hit - trying to serve index.html");
  const indexPath = path.join(__dirname, "public", "index.html");
  console.log("Index.html path:", indexPath);

  // Check if file exists
  const fs = require("fs");
  if (fs.existsSync(indexPath)) {
    console.log("index.html found!");
    res.sendFile(indexPath);
  } else {
    console.log("index.html NOT found!");
    res.status(404).send("index.html not found at: " + indexPath);
  }
});

// Game state
const rooms = new Map();
const playerColors = [
  "#dda0dd",
  "#4ecdc4",
  "#45b7d1",
  "#96ceb4",
  "#ffeaa7",
  "#f2a2c7",
  "#98d8c8",
  "#f7dc6f",
];

function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function generateDots() {
  const dots = [];
  for (let i = 0; i < 20; i++) {
    dots.push({
      id: i,
      x: Math.random() * 760 + 20,
      y: Math.random() * 560 + 20,
      type: "normal", // normal or special
      points: 1,
    });
  }
  return dots;
}

function addSpecialDot(room) {
  const specialDot = {
    id: Date.now() + Math.random(),
    x: Math.random() * 760 + 20,
    y: Math.random() * 560 + 20,
    type: "special",
    points: 10,
  };

  room.dots.push(specialDot);

  // Notify all players about the special dot
  io.to(room.id).emit("specialDotAdded", specialDot);

  console.log(`Special dot added to room ${room.id}`);
}

function endGameWithResults(room) {
  if (!room.gameStarted) return;

  room.gameStarted = false;

  // Clear timers
  if (room.gameTimer) {
    clearTimeout(room.gameTimer);
    room.gameTimer = null;
  }
  if (room.specialDotInterval) {
    clearInterval(room.specialDotInterval);
    room.specialDotInterval = null;
  }

  // Calculate winner
  const currentPlayersData = Array.from(room.players.values()).map((p) => ({
    ...p,
  })); // Create a snapshot of players with their final scores
  const maxScore = Math.max(...currentPlayersData.map((p) => p.score));
  const winners = currentPlayersData.filter((p) => p.score === maxScore);

  let resultMessage;
  if (winners.length === 1) {
    const winner = winners[0];
    const losers = currentPlayersData.filter((p) => p.id !== winner.id);
    if (losers.length > 0) {
      const loserNames = losers.map((l) => l.name).join(", ");
      resultMessage = `🎉 ${winner.name} wins with ${
        winner.score
      } points! ${loserNames} ${losers.length > 1 ? "lose" : "loses"}.`;
    } else {
      // Should not happen in a typical game with >1 player, but good for robustness
      resultMessage = `🎉 ${winner.name} wins with ${winner.score} points!`;
    }
  } else if (winners.length > 1) {
    // Tie condition
    const winnerNames = winners.map((w) => w.name).join(", ");
    resultMessage = `🎉 It's a tie between ${winnerNames} with ${maxScore} points each!`;
  }

  // Reset game state for the room (scores, positions, dots) AFTER capturing final scores
  room.dots = [];
  room.players.forEach((player) => {
    // Note: player object here is the one in room.players, not from currentPlayersData snapshot
    player.x = Math.random() * 750 + 25;
    player.y = Math.random() * 550 + 25;
    player.score = 0;
  });

  io.to(room.id).emit("gameEnded", {
    // Pass the results data to the client
    resultMessage: resultMessage,
    finalScores: currentPlayersData, // Send the snapshot with correct scores
  });

  console.log(`Game ended in room ${room.id}: ${resultMessage}`);
}

io.on("connection", (socket) => {
  console.log("Player connected:", socket.id);

  socket.on("createRoom", (playerName) => {
    const roomId = generateRoomId();
    const room = {
      id: roomId,
      host: socket.id,
      players: new Map(),
      dots: [],
      gameStarted: false,
      gameTimer: null,
      specialDotInterval: null,
      gameStartTime: null,
    };

    // Add host to room
    room.players.set(socket.id, {
      id: socket.id,
      name: playerName,
      x: Math.random() * 750 + 25,
      y: Math.random() * 550 + 25,
      score: 0,
      color: playerColors[0],
      isHost: true,
    });

    rooms.set(roomId, room);
    socket.join(roomId);
    socket.roomId = roomId;

    socket.emit("roomCreated", {
      roomId: roomId,
      playerId: socket.id,
      isHost: true,
    });

    // Send updated player list
    io.to(roomId).emit("playersUpdated", Array.from(room.players.values()));

    console.log(`Room ${roomId} created by ${playerName}`);
  });

  socket.on("joinRoom", (data) => {
    const { roomId, playerName } = data;
    const room = rooms.get(roomId);

    if (!room) {
      socket.emit("error", "Room not found!");
      return;
    }

    if (room.gameStarted) {
      socket.emit("error", "Game already in progress!");
      return;
    }

    if (room.players.size >= 8) {
      socket.emit("error", "Room is full!");
      return;
    }

    // Add player to room
    room.players.set(socket.id, {
      id: socket.id,
      name: playerName,
      x: Math.random() * 750 + 25,
      y: Math.random() * 550 + 25,
      score: 0,
      color: playerColors[room.players.size % playerColors.length],
      isHost: false,
    });

    socket.join(roomId);
    socket.roomId = roomId;

    socket.emit("roomJoined", {
      roomId: roomId,
      playerId: socket.id,
      isHost: false,
    });

    // Send updated player list to all players in room
    io.to(roomId).emit("playersUpdated", Array.from(room.players.values()));

    console.log(`${playerName} joined room ${roomId}`);
  });

  socket.on("startGame", () => {
    const roomId = socket.roomId;
    const room = rooms.get(roomId);

    if (!room || room.host !== socket.id) {
      socket.emit("error", "Only host can start the game!");
      return;
    }

    room.gameStarted = true;
    room.dots = generateDots();
    room.gameStartTime = Date.now();
    const gameDuration = 60000; // 60 seconds

    // Reset player scores and positions
    room.players.forEach((player) => {
      player.score = 0;
      player.x = Math.random() * 750 + 25;
      player.y = Math.random() * 550 + 25;
    });

    // Set 1-minute game timer
    room.gameTimer = setTimeout(() => {
      // This timer ends the game
      endGameWithResults(room);
    }, gameDuration);

    // Set special dot interval (every 10 seconds)
    room.specialDotInterval = setInterval(() => {
      // This timer adds special dots
      if (room.gameStarted) {
        addSpecialDot(room);
      }
    }, 10000); // 10 seconds interval

    io.to(roomId).emit("gameStarted", {
      players: Array.from(room.players.values()),
      dots: room.dots,
      gameTime: 60, // 60 seconds
    });

    console.log(`Game started in room ${roomId} - 60 second timer activated`);
  });

  socket.on("playerMove", (position) => {
    const roomId = socket.roomId;
    const room = rooms.get(roomId);

    if (!room || !room.gameStarted) return;

    const player = room.players.get(socket.id);
    if (!player) return;

    // Update player position
    player.x = Math.max(15, Math.min(785, position.x));
    player.y = Math.max(15, Math.min(585, position.y));

    // Check dot collisions
    for (let i = room.dots.length - 1; i >= 0; i--) {
      const dot = room.dots[i];
      const dx = player.x - dot.x;
      const dy = player.y - dot.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < 20) {
        // Player collected dot
        const points = dot.points || 1;
        player.score += points;
        room.dots.splice(i, 1);

        // Add new normal dot (not special)
        const newDot = {
          id: Date.now() + Math.random(),
          x: Math.random() * 760 + 20,
          y: Math.random() * 560 + 20,
          type: "normal",
          points: 1,
        };
        room.dots.push(newDot);

        // Notify all players
        io.to(roomId).emit("dotCollected", {
          playerId: socket.id,
          newDot: newDot,
          dotId: dot.id, // Send the ID of the collected dot
          points: points,
          dotType: dot.type,
        });
        break;
      }
    }

    // Broadcast player position to other players
    socket.to(roomId).emit("playerMoved", {
      playerId: socket.id,
      x: player.x,
      y: player.y,
    });

    // Send updated scores
    io.to(roomId).emit("scoresUpdated", Array.from(room.players.values()));
  });

  socket.on("endGame", () => {
    const roomId = socket.roomId;
    const room = rooms.get(roomId);

    if (!room || room.host !== socket.id) {
      socket.emit("error", "Only host can end the game!");
      return;
    }

    endGameWithResults(room);
  });

  socket.on("leaveRoom", () => {
    const roomId = socket.roomId;
    const room = rooms.get(roomId);

    if (room) {
      room.players.delete(socket.id);

      // Clear timers if host leaves
      if (room.host === socket.id) {
        if (room.gameTimer) clearTimeout(room.gameTimer);
        if (room.specialDotInterval) clearInterval(room.specialDotInterval);
        // If host leaves, end the game for everyone else gracefully
        rooms.delete(roomId);
        io.to(roomId).emit("roomClosed");
        console.log(`Room ${roomId} closed - host left`);
      } else {
        // Update other players
        io.to(roomId).emit("playersUpdated", Array.from(room.players.values()));
        console.log(`Player left room ${roomId}`);
      }
    }

    socket.leave(roomId);
    socket.roomId = null;
  });

  socket.on("disconnect", () => {
    console.log("Player disconnected:", socket.id);

    const roomId = socket.roomId;
    const room = rooms.get(roomId);

    if (room) {
      room.players.delete(socket.id);

      // If host disconnects, clear timers and delete room
      if (room.host === socket.id) {
        if (room.gameTimer) clearTimeout(room.gameTimer);
        if (room.specialDotInterval) clearInterval(room.specialDotInterval);
        // If host disconnects, end the game for everyone else gracefully
        rooms.delete(roomId);
        io.to(roomId).emit("roomClosed");
        console.log(`Room ${roomId} closed - host disconnected`);
      } else {
        // Update other players
        io.to(roomId).emit("playersUpdated", Array.from(room.players.values()));
      }
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Visit http://localhost:${PORT} to play the game`);
});
