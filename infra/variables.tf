variable "region" {
  type    = string
  default = "us-east-1"
}

variable "name" {
  type    = string
  default = "callcenter"
}

variable "instance_type" {
  type    = string
  default = "t3.small"
}

variable "db_instance_class" {
  type    = string
  default = "db.t4g.micro"
}

variable "elevenlabs_api_key" {
  type      = string
  default   = ""
  sensitive = true
}
