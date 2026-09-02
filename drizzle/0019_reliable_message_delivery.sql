ALTER TABLE messages ADD COLUMN client_message_id text;
CREATE UNIQUE INDEX IF NOT EXISTS messages_sender_client_idx
  ON messages (business_id, conversation_id, sender_type, sender_id, client_message_id)
  WHERE client_message_id IS NOT NULL;
