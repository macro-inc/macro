INSERT INTO public."User" ("id","email","stripeCustomerId")
(SELECT 'macro|user@user.com', 'user@user.com','stripe_id');

INSERT INTO public."Document" ("id","name","fileType", "owner")
(SELECT 'document-one', 'test_document_name','pdf', 'macro|user@user.com');

INSERT INTO public."DocumentText" ("id", "content", "documentId", "tokenCount")
(SELECT 1, 'This is a test document', 'document-one', 0);

INSERT INTO public."Document" ("id","name","fileType", "owner")
(SELECT 'document-empty', 'test_document_name_empty','pdf', 'macro|user@user.com');

INSERT INTO public."DocumentText" ("id", "content", "documentId", "tokenCount")
(SELECT 2, '', 'document-empty', 0);

INSERT INTO public."Document" ("id","name","fileType", "owner")
(SELECT 'document-insufficient', 'test_document_name_insufficient','pdf', 'macro|user@user.com');

INSERT INTO public."DocumentText" ("id", "content", "documentId", "tokenCount")
(SELECT 3, 'Insufficient Content', 'document-insufficient', 0);

INSERT INTO public."Document" ("id","name","fileType", "owner")
(SELECT 'document-complete', 'test_document_name_complete','pdf', 'macro|user@user.com');

INSERT INTO public."DocumentText" ("id", "content", "documentId", "tokenCount")
(SELECT 4, 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed non risus. Suspendisse lectus tortor, dignissim sit amet, adipiscing nec, ultricies sed, dolor. Cras elementum ultrices diam. Maecenas ligula massa, varius a, semper congue, euismod non, mi. Proin porttitor, orci nec nonummy molestie, enim est eleifend mi, non fermentum diam nisl sit amet erat. Duis semper. Duis arcu massa, scelerisque vitae, consequat in, pretium a, enim. Pellentesque congue. Ut in risus volutpat libero pharetra tempor. Cras vestibulum bibendum augue. Praesent egestas leo in pede. Praesent blandit odio eu enim. Pellentesque sed dui ut augue blandit sodales. Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia Curae; Aliquam nibh. Mauris ac mauris sed pede pellentesque fermentum. Maecenas adipiscing ante non diam sodales hendrerit. Ut velit mauris, egestas sed, gravida nec, ornare ut, mi. Aenean ut orci vel massa suscipit pulvinar. Nulla sollicitudin. Fusce varius, ligula non tempus aliquam, nunc turpis ullamcorper nibh, in tempus sapien eros vitae ligula. Pellentesque rhoncus nunc et augue. Integer id felis. Curabitur aliquet pellentesque diam. Integer quis metus vitae elit lobortis egestas. Lorem ipsum dolor sit amet, consectetuer adipiscing elit. Morbi vel erat non mauris convallis vehicula.', 'document-complete', 0);

INSERT INTO public."Document" ("id","name","fileType", "owner")
(SELECT 'document-incomplete', 'test_document_name_incomplete','pdf', 'macro|user@user.com');