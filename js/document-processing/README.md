# Document Processing

Contains all items related to how the Web app will handle async document
processing.

## Usage

You can use the `/docs` endpoint for a full swagger.

## Local Development

*First time*

The first time you run the pdf/docx services, since they use the ECR image you
will need to first login to ECR docker registry so the images can be pulled.
`aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin 569036502058.dkr.ecr.us-east-1.amazonaws.com`

The producer service is available at `http://localhost:4000`
The consumer service is available at `http://localhost:4001`

## Deployment

To learn more read the [infra](./infra/README.md) documentation.

## More Information

I highly encourage you to read through the README.md of each sub-folder in
the `document-processing` space to learn more about everything that is part of
this ecosystem.

## Diagram

```mermaid
flowchart LR
producer(Producer Service)
consumer(Consumer Service)
user(User)
doc_storage[(Doc Storage Bucket)]
result_storage[(Result Storage Bucket)]
db[(MacroDB)]
pdf_service(Pdf Service)
docx_service(Docx Service)
pdf_preprocess(Pdf Preprocess Lambda)
pdf_convert(Pdf Convert Lambda)
pdf_ocr(Pdf Ocr Lambda)

user --> producer

producer --sends result--> user
producer --queues job--> consumer

consumer --sends response back--> producer
consumer --processes job --> consumer
consumer --> db
consumer --> doc_storage
consumer --> result_storage
consumer --> pdf_preprocess
consumer --> pdf_ocr
consumer --> pdf_convert
consumer --> pdf_service
consumer --> docx_service

doc_storage --> pdf_convert
pdf_convert --> result_storage

doc_storage --> pdf_ocr
pdf_ocr --> result_storage

doc_storage --> pdf_preprocess
pdf_preprocess --> db
```
