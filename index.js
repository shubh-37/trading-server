const express = require("express");
const app = express();
const connectDB = require("./connect");
const axios = require("axios");
const redis = require("redis");

// Middleware
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Hello World");
});

 // Helper function to parse symbol
 function parseSymbol(symbol) {
    // Extract base name, date, and strike price
    // Example: NIFTY250930P25200 -> { base: 'NIFTY250930', type: 'P', strike: '25200' }
    const regex = /^(.+?)([PC])(\d+)$/;
    const match = symbol.match(regex);

    if (!match) {
      throw new Error(`Invalid symbol format: ${symbol}`);
    }

    return {
      base: match[1], // NIFTY250930
      type: match[2], // P or C
      strike: match[3], // 25200
      counterpart: match[1] + (match[2] === 'P' ? 'C' : 'P') + match[3] // NIFTY250930C25200
    };
  }

  // Helper function to determine if signals should be paired for "both signal" scenario
  function shouldSendBothSignals(firstSignal, secondSignal, firstType, secondType) {
    const validPairs = [
      // Short Entry of P should be followed by Long Entry of C
      { first: { type: 'P', signal: 'Short Entry' }, second: { type: 'C', signal: 'Long Entry' } },
      // Short Entry of C should be followed by Long Entry of P
      { first: { type: 'C', signal: 'Short Entry' }, second: { type: 'P', signal: 'Long Entry' } },
      // Long Entry of P should be followed by Short Entry of C
      { first: { type: 'P', signal: 'Long Entry' }, second: { type: 'C', signal: 'Short Entry' } },
      // Long Entry of C should be followed by Short Entry of P
      { first: { type: 'C', signal: 'Long Entry' }, second: { type: 'P', signal: 'Short Entry' } }
    ];

    return validPairs.some(
      (pair) =>
        pair.first.type === firstType &&
        pair.first.signal === firstSignal &&
        pair.second.type === secondType &&
        pair.second.signal === secondSignal
    );
  }

  // Helper function to determine if signals should be paired for "entry signal only" scenario
  function shouldSendEntrySignalOnly(firstSignal, secondSignal, firstType, secondType) {
    const validPairs = [
      // Short Entry of C should be followed by Short Exit of P
      { first: { type: 'C', signal: 'Short Entry' }, second: { type: 'P', signal: 'Short Exit' } },
      // Short Entry of P should be followed by Short Exit of C
      { first: { type: 'P', signal: 'Short Entry' }, second: { type: 'C', signal: 'Short Exit' } },
      // Long Entry of C should be followed by Long Exit of P
      { first: { type: 'C', signal: 'Long Entry' }, second: { type: 'P', signal: 'Long Exit' } },
      // Long Entry of P should be followed by Long Exit of C
      { first: { type: 'P', signal: 'Long Entry' }, second: { type: 'C', signal: 'Long Exit' } }
    ];

    return validPairs.some(
      (pair) =>
        pair.first.type === firstType &&
        pair.first.signal === firstSignal &&
        pair.second.type === secondType &&
        pair.second.signal === secondSignal
    );
  }

  // Function to send signals (replace with your actual implementation)
  async function sendBothSignals(firstTrade, secondTrade) {
    console.log('🚀 SENDING BOTH SIGNALS:');
    await axios.post('http://94.136.190.186/sha/test4', {
      message: 'Sending Both Signals',
      firstTrade,
      secondTrade
    });
    console.log('First Signal:', {
      symbol: firstTrade.symbol,
      signal: firstTrade.signal,
      price: firstTrade.price,
      quantity: firstTrade.quantity,
      timestamp: firstTrade.timestamp
    });
    console.log('Second Signal:', {
      symbol: secondTrade.symbol,
      signal: secondTrade.signal,
      price: secondTrade.price,
      quantity: secondTrade.quantity,
      timestamp: secondTrade.timestamp
    });
    console.log('---');
    
    // Store both trades in database with status 'Holding'
    await storeTradesToDB([firstTrade, secondTrade]);
  }

  async function sendEntrySignalOnly(entryTrade, exitTrade) {
    console.log('📈 SENDING ENTRY SIGNAL ONLY:');
    await axios.post('http://94.136.190.186/sha/test4', {
      message: 'Sending Entry Signal only',
      entryTrade
    });
    console.log('Entry Signal:', {
      symbol: entryTrade.symbol,
      signal: entryTrade.signal,
      price: entryTrade.price,
      quantity: entryTrade.quantity,
      timestamp: entryTrade.timestamp
    });
    console.log('Paired with exit:', {
      symbol: exitTrade.symbol,
      signal: exitTrade.signal,
      price: exitTrade.price,
      quantity: exitTrade.quantity,
      timestamp: exitTrade.timestamp
    });
    console.log('---');
    
    // Store only entry trade in database with status 'Holding'
    await storeTradesToDB([entryTrade]);
  }

  // Helper function to store trades in database
  async function storeTradesToDB(trades) {
    try {
      for (const trade of trades) {
        const symbolInfo = parseSymbol(trade.symbol);
        
        const newTrade = new Models.Trade({
          symbol: trade.symbol,
          signal: trade.signal,
          type: symbolInfo.type,
          qty: trade.quantity,
          status: 'Holding',
          price: trade.price,
          timestamp: new Date(trade.timestamp)
        });
        
        await newTrade.save();
        console.log(`💾 Stored trade in DB:`, {
          symbol: trade.symbol,
          signal: trade.signal,
          type: symbolInfo.type,
          status: 'Holding'
        });
      }
    } catch (error) {
      console.error('Error storing trades in database:', error);
    }
  }

  // Main trading endpoint
  app.post('/trading', async (req, reply) => {
    try {
      const { symbol, signal, price, quantity } = req.body;
      const timestamp = Date.now();

      console.log('Trading Log:', { symbol, signal, price, timestamp });

      // Parse the symbol
      const symbolInfo = parseSymbol(symbol);
      
      // Check if there's an existing holding in database
      const existingHolding = await Models.Trade.findOne({
        symbol: symbol,
        status: 'Holding'
      });

      if (existingHolding) {
        console.log('🔍 Found existing holding in database:', existingHolding);
        
        // Send as exit trade
        const exitTrade = {
          symbol: symbol,
          signal: signal,
          price: price, 
          quantity: quantity,
          timestamp: timestamp
        };
        
        console.log('📤 SENDING EXIT SIGNAL FOR EXISTING HOLDING:');
        await axios.post('http://94.136.190.186/sha/test4', {
          message: 'Sending Exit Signal for Existing Holding',
          exitTrade
        });
        
        console.log('Exit Signal:', exitTrade);
        
        // Update existing holding status to 'Sent'
        await Models.Trade.findByIdAndUpdate(existingHolding._id, {
          status: 'Sent'
        });
        
        console.log('✅ Updated existing holding status to Sent');
      }

      const redisKey = `trade:${symbolInfo.base}:${symbolInfo.strike}`;

      // Check if there's a pending trade in Redis
      const existingTradeData = await redisClient.get(redisKey);

      if (existingTradeData) {
        // Parse existing trade
        const existingTrade = JSON.parse(existingTradeData);

        // Verify timestamp (additional check beyond TTL)
        const timeDiff = timestamp - existingTrade.timestamp;
        if (timeDiff > 5000) {
          // 5 seconds in milliseconds
          console.log('⏰ Existing trade expired (timestamp check), removing...');
          await redisClient.del(redisKey);
        } else {
          // Parse existing symbol to get its type
          const existingSymbolInfo = parseSymbol(existingTrade.symbol);

          // Check if current symbol is the counterpart of existing symbol
          if (symbol === existingSymbolInfo.counterpart) {
            console.log('✅ Found matching counterpart trade!');

            const currentTrade = { symbol, signal, price, quantity, timestamp };

            // Check if we should send both signals
            if (shouldSendBothSignals(existingTrade.signal, signal, existingSymbolInfo.type, symbolInfo.type)) {
              await sendBothSignals(existingTrade, currentTrade);
            }
            // Check if we should send entry signal only
            else if (
              shouldSendEntrySignalOnly(existingTrade.signal, signal, existingSymbolInfo.type, symbolInfo.type)
            ) {
              // Send the entry signal (the non-exit signal)
              const entryTrade = existingTrade.signal.includes('Exit') ? currentTrade : existingTrade;
              const exitTrade = existingTrade.signal.includes('Exit') ? existingTrade : currentTrade;
              await sendEntrySignalOnly(entryTrade, exitTrade);
            } else {
              console.log('❌ Signal pair does not match any valid combination');
              console.log(
                `First: ${existingSymbolInfo.type} ${existingTrade.signal}, Second: ${symbolInfo.type} ${signal}`
              );
            }

            // Remove the paired trade from Redis
            await redisClient.del(redisKey);
          } else {
            console.log('❌ Symbol mismatch - not a valid counterpart');
            console.log(`Expected counterpart: ${existingSymbolInfo.counterpart}, Got: ${symbol}`);
          }
        }
      } else {
        // No existing trade found, store current trade in Redis
        console.log('💾 Storing new trade in Redis...');

        const tradeData = {
          symbol,
          signal,
          price,
          quantity,
          timestamp
        };

        // Store in Redis with 5 second TTL
        await redisClient.setEx(redisKey, 5, JSON.stringify(tradeData));
        console.log(`Stored trade with key: ${redisKey}`);
      }

      return reply.send({ status: 'ok' });
    } catch (error) {
      console.error('Error processing trading signal:', error);
      return reply.status(500).send({ status: 'error', message: error.message });
    }
  });

  // Optional: Add endpoint to check current holdings
  app.get('/holdings', async (req, res) => {
    try {
      const holdings = await Models.Trade.find({ status: 'Holding' });
      return res.json({ holdings });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  // Optional: Add endpoint to check trade history
  app.get('/trades', async (req, res) => {
    try {
      const trades = await Models.Trade.find().sort({ createdAt: -1 });
      return res.json({ trades });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  // Global variables to store Models and Redis client
  let Models = {};
  let redisClient = null;

  try {
    async function start() {
      // Connect to MongoDB and get Models
      const { Models: dbModels } = await connectDB();
      Models = dbModels;
      
      // Set up Redis client
      redisClient = redis.createClient({
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT || 6379
      });
      
      redisClient.on('error', (err) => {
        console.error('Redis Client Error:', err);
      });
      
      await redisClient.connect();
      console.log('Connected to Redis');
      
      app.listen(3000, async () => {
        console.log("Server is running on port 3000");
        console.log("Available Models:", Object.keys(Models));
      });
    }
    start();
  } catch (error) {
    console.error("Sorry! Cannot start the server!", error);
  }

module.exports = app;