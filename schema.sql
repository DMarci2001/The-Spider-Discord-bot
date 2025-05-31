-- Database schema for Type&Draft bot
-- SQLite3 version with IF NOT EXISTS

-- Users table - core user data  
CREATE TABLE IF NOT EXISTS users (
    user_id TEXT PRIMARY KEY,
    total_feedback_all_time INTEGER DEFAULT 0,
    current_credits INTEGER DEFAULT 0,
    bookshelf_posts INTEGER DEFAULT 0,
    chapter_leases INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Monthly feedback tracking
CREATE TABLE IF NOT EXISTS monthly_feedback (
    user_id TEXT,
    month_key TEXT,
    count INTEGER DEFAULT 0,
    PRIMARY KEY (user_id, month_key),
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- Store purchases tracking
CREATE TABLE IF NOT EXISTS purchases (
    user_id TEXT,
    item_key TEXT,
    purchased_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, item_key),
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- Logged feedback messages (prevent double counting)
CREATE TABLE IF NOT EXISTS logged_feedback (
    message_id TEXT,
    user_id TEXT,
    logged_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (message_id, user_id),
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- Pardon system for monthly requirements
CREATE TABLE IF NOT EXISTS pardons (
    user_id TEXT,
    month_key TEXT,
    pardoned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, month_key),
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- Faceless command cooldowns
CREATE TABLE IF NOT EXISTS faceless_cooldowns (
    user_id TEXT PRIMARY KEY,
    last_used BIGINT,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- Indexes for better performance
CREATE INDEX IF NOT EXISTS idx_monthly_feedback_month ON monthly_feedback(month_key);
CREATE INDEX IF NOT EXISTS idx_purchases_item ON purchases(item_key);
CREATE INDEX IF NOT EXISTS idx_logged_feedback_message ON logged_feedback(message_id);
CREATE INDEX IF NOT EXISTS idx_pardons_month ON pardons(month_key);
CREATE INDEX IF NOT EXISTS idx_users_credits ON users(current_credits);
CREATE INDEX IF NOT EXISTS idx_users_feedback ON users(total_feedback_all_time);
