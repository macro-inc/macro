# AWS ECS Deployment with Pulumi

This project uses [Pulumi](https://www.pulumi.com/) with TypeScript to deploy containerized applications (`docx-server` and `pdf-server`) to AWS Elastic Container Service (ECS) and expose them via Application Load Balancers (ALBs).

## Prerequisites

Before you begin, ensure you have the following installed:

- [Node.js](https://nodejs.org/)
- [Pulumi](https://www.pulumi.com/docs/get-started/install/)
- [AWS CLI](https://aws.amazon.com/cli/) configured with your AWS account

## Project Structure

- `index.ts`: The main Pulumi program file that defines the infrastructure as code.
- `Dockerfile` for `docx-server`: Located at `../docx-server/Dockerfile`.
- `Dockerfile` for `pdf-server`: Located at `../pdf-server/pdfreader/Dockerfile`.

## Setup and Deployment

1. **Clone the repository**

   Start by cloning this repository to your local machine.
2. **Install dependencies**

   Navigate to the project directory and install the necessary NPM packages:

   ```bash
   yarn install
   ```

# Deploying Manually:

### Step 1: Create a Load Balancer

1. **Navigate to the EC2 Dashboard** in the AWS Management Console.
2. **Go to Load Balancers** under the "Load Balancing" section and click **Create Load Balancer**.
3. Choose **Application Load Balancer** or **Network Load Balancer** depending on your needs. Application Load Balancers are well-suited for HTTP/HTTPS applications.
4. **Configure the Load Balancer**:
   - Name your load balancer.
   - Select internet-facing.
   - Choose the VPC where your ECS tasks are running.
   - Select at least two availability zones and subnets (ensure these subnets are public if you want the service to be accessible from the internet).
5. **Configure Security Groups** for your load balancer to allow inbound traffic on the ports you need (e.g., 80 for HTTP or 443 for HTTPS).
6. **Configure Routing**:
   - Create a new target group.
   - Choose the target type as IP addresses (since Fargate uses IP-based targeting).
   - Set protocol and port according to your application (e.g., HTTP on port 80).
   - Define health checks for your service.
7. **Register Targets**: Skip this step during creation since ECS will manage this part.
8. **Review and Create** the load balancer.

### Step 2: Update ECS Service to Use the Load Balancer

1. **Navigate to the ECS Dashboard** and select your cluster.
2. **Find your service** and click **Update**.
3. In the **Load Balancing** section of the service configuration:
   - Choose the load balancer you created.
   - Under the load balancer settings, for each container that needs to be accessible, specify the container name and the container port to forward traffic to. Associate it with the target group you created.
4. **Review and update the service**. ECS will redeploy tasks as needed to apply these changes.

### Step 3: Task Definition Networking Configuration

Ensure your task definition's network mode is set to **awsvpc** to allow Fargate tasks to be associated with a network interface.

- If creating a new revision of your task definition, choose the **awsvpc** network mode.
- Specify the task execution IAM role that has permissions to interact with networking resources.

### Step 4: DNS and Service Access

Once your service is updated and tasks are running:

- The **DNS name of the load balancer** can be found in the EC2 Dashboard under the "Load Balancers" section. This DNS name is what you'll use to access your service publicly.
