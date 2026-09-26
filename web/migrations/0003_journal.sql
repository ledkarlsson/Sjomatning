CREATE TABLE journal_events (
  owner TEXT NOT NULL,
  id TEXT NOT NULL,
  data TEXT NOT NULL,
  revision INTEGER NOT NULL,
  mutation TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(owner,id)
);
