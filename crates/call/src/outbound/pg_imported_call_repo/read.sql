SELECT jsonb_build_object(
    'entity', jsonb_build_object(
        'id', c.id, 'userId', c.user_id, 'title', c.title, 'createdVia', c.created_via,
        'startedAt', c.started_at, 'endedAt', c.ended_at, 'durationMs', c.duration_ms,
        'channelId', c.channel_id, 'meetingId', c.meeting_id,
        'createdAt', c.created_at, 'updatedAt', c.updated_at
    ),
    'sources', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'userId', s.user_id, 'namespace', s.namespace, 'provider', s.provider,
            'objectType', s.object_type, 'externalId', s.external_id, 'externalUrl', s.external_url,
            'externalUpdatedAt', s.external_updated_at, 'syncedAt', s.synced_at,
            'metadata', s.metadata - 'participantIds' - 'transcriptId'
        )) FROM call_entity_sources s WHERE s.call_id = c.id
    ), '[]'::jsonb),
    'participants', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'id', p.id, 'userId', p.user_id, 'displayName', p.display_name,
            'email', p.email, 'phone', p.phone, 'externalId', p.external_id,
            'attendance', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'id', a.id, 'joinedAt', a.joined_at, 'leftAt', a.left_at
            ) ORDER BY a.id) FROM call_entity_attendance a
            WHERE a.call_id = p.call_id AND a.participant_id = p.id), '[]'::jsonb)
        ) ORDER BY p.id) FROM call_entity_participants p WHERE p.call_id = c.id
    ), '[]'::jsonb),
    'recordings', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', r.id, 'mediaType', r.media_type,
        'location', jsonb_build_object(
            'kind', CASE WHEN r.storage_key IS NOT NULL THEN 'storage_key' ELSE 'external_url' END,
            'value', COALESCE(r.storage_key, r.external_url)),
        'mimeType', r.mime_type, 'durationMs', r.duration_ms, 'startedAt', r.started_at
    ) ORDER BY r.id) FROM call_entity_recordings r WHERE r.call_id = c.id), '[]'::jsonb),
    'transcripts', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'id', t.id, 'recordingId', t.recording_id, 'language', t.language,
            'provider', t.provider, 'startedAt', t.started_at,
            'segments', COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                    'sequenceNum', s.sequence_num, 'participantId', s.participant_id,
                    'speakerLabel', s.speaker_label, 'content', s.content,
                    'startMs', s.start_ms, 'endMs', s.end_ms
                ) ORDER BY s.sequence_num) FROM call_entity_transcript_segments s
                WHERE s.call_id = t.call_id AND s.transcript_id = t.id
            ), '[]'::jsonb)
        ) ORDER BY t.id) FROM call_entity_transcripts t WHERE t.call_id = c.id
    ), '[]'::jsonb)
) AS "record!"
FROM call_entities c
WHERE c.user_id = $1 AND c.id = $2 AND c.created_via = 'import';
