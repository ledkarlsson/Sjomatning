CREATE UNIQUE INDEX files_owner_sync ON files(owner, json_extract(metadata, '$.syncId')) WHERE json_extract(metadata, '$.syncId') IS NOT NULL;
