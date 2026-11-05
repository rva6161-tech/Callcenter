output "site_url" {
  value = "https://${aws_cloudfront_distribution.cdn.domain_name}"
}

output "cloudfront_id" {
  value = aws_cloudfront_distribution.cdn.id
}

output "instance_id" {
  value = aws_instance.app.id
}

output "site_bucket" {
  value = aws_s3_bucket.site.bucket
}

output "artifact_bucket" {
  value = aws_s3_bucket.artifacts.bucket
}
