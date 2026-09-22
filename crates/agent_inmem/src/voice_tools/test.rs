use super::*;

struct PendingQuestion {
    asked: CancellationToken,
}

#[async_trait::async_trait]
impl UserInputRequester for PendingQuestion {
    async fn ask(&self, _: UserInputRequest) -> Result<UserInputOutcome, UserInputError> {
        self.asked.cancel();
        std::future::pending().await
    }
}

#[tokio::test]
async fn interruption_dismisses_questions_and_prevents_late_questions() {
    for interrupt_before_asking in [false, true] {
        let asked = CancellationToken::new();
        let cancel = CancellationToken::new();
        let requester = TurnQuestionRequester {
            inner: Arc::new(PendingQuestion {
                asked: asked.clone(),
            }),
            cancel: cancel.clone(),
        };
        if interrupt_before_asking {
            cancel.cancel();
        }
        let question = tokio::spawn(async move {
            requester
                .ask(UserInputRequest {
                    question: "Which document?".to_owned(),
                    options: Vec::new(),
                })
                .await
        });
        if !interrupt_before_asking {
            asked.cancelled().await;
            cancel.cancel();
        }
        assert_eq!(question.await.unwrap(), Ok(UserInputOutcome::Cancelled));
        assert_eq!(asked.is_cancelled(), !interrupt_before_asking);
    }
}
