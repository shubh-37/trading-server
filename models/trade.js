const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const modelProperties = {
    symbol: String,
    signal: String,
    type: String,
    qty: Number,
    status: String,
    price: Number,
    timestamp: Date
};

const modelOptions = {
  timestamps: true
};

const TradeSchema = Schema(modelProperties, modelOptions);

module.exports = TradeSchema;
