-- Supabase에서 실행할 RPC 함수
-- 퀴즈 정답 수 증가 (atomic operation)

CREATE OR REPLACE FUNCTION increment_correct(session_id_param INT)
RETURNS VOID AS $$
BEGIN
  UPDATE quiz_sessions
  SET correct_answers = correct_answers + 1
  WHERE id = session_id_param;
END;
$$ LANGUAGE plpgsql;
