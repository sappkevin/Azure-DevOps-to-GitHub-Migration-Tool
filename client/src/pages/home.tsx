import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Cloud as AzureIcon, Github as GitHubIcon } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { azureAuthSchema, githubAuthSchema } from "@shared/schema";
import { validateAzurePAT, validateGitHubPAT } from "@/lib/auth";
import { useLocation } from "wouter";
import { z } from "zod";

// Combined schema for both tokens
const tokenSchema = z.object({
  azureToken: azureAuthSchema.shape.token,
  azureOrganization: azureAuthSchema.shape.organization,
  githubToken: githubAuthSchema.shape.token
});

type TokenFormData = z.infer<typeof tokenSchema>;

export default function Home() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [isConnecting, setIsConnecting] = useState(false);

  const form = useForm<TokenFormData>({
    resolver: zodResolver(tokenSchema),
    defaultValues: {
      azureToken: "",
      azureOrganization: "",
      githubToken: ""
    }
  });

  // Track if all required fields are entered
  const formValues = form.watch();
  const isFormValid = formValues.azureToken.trim() !== "" && 
                     formValues.azureOrganization.trim() !== "" && 
                     formValues.githubToken.trim() !== "";

  async function onSubmit(data: TokenFormData) {
    if (!data.azureToken || !data.azureOrganization || !data.githubToken) {
      toast({
        title: "Validation Error",
        description: "Azure token, organization name, and GitHub token are required",
        variant: "destructive"
      });
      return;
    }

    try {
      setIsConnecting(true);

      // First validate the Azure PAT
      console.log("Validating Azure PAT...");
      try {
        await validateAzurePAT(data.azureToken, data.azureOrganization);
        console.log("Azure PAT validation successful");
      } catch (error) {
        console.error("Azure PAT validation failed:", error);
        throw new Error("Azure PAT validation failed: " + (error instanceof Error ? error.message : "Unknown error"));
      }

      // Then validate the GitHub PAT
      console.log("Validating GitHub PAT...");
      try {
        await validateGitHubPAT(data.githubToken);
        console.log("GitHub PAT validation successful");
      } catch (error) {
        console.error("GitHub PAT validation failed:", error);
        throw new Error("GitHub PAT validation failed: " + (error instanceof Error ? error.message : "Unknown error"));
      }

      // Store tokens in session storage
      sessionStorage.setItem("azure_token", data.azureToken);
      sessionStorage.setItem("azure_organization", data.azureOrganization);
      sessionStorage.setItem("github_token", data.githubToken);

      toast({
        title: "Connection Successful",
        description: "Successfully validated tokens. Loading repositories..."
      });

      // Navigate to migration page
      setLocation("/migration");
    } catch (error) {
      console.error("Connection process failed:", error);

      // Clear tokens on failure
      sessionStorage.removeItem("azure_token");
      sessionStorage.removeItem("azure_organization");
      sessionStorage.removeItem("github_token");

      toast({
        title: "Connection Failed",
        description: error instanceof Error ? error.message : "Failed to validate tokens",
        variant: "destructive"
      });
    } finally {
      setIsConnecting(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white">
      <div className="container mx-auto px-4 py-16">
        <div className="max-w-3xl mx-auto text-center mb-12">
          <h1 className="text-4xl font-bold tracking-tight mb-4">
            Azure DevOps to GitHub Migration Tool
          </h1>
          <p className="text-lg text-gray-600">
            Easily migrate your repositories and pipelines from Azure DevOps to GitHub
            with our automated migration tool.
          </p>
        </div>

        <div className="max-w-2xl mx-auto">
          <Card>
            <CardHeader>
              <CardTitle>Enter Credentials</CardTitle>
            </CardHeader>
            <CardContent>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                  <FormField
                    control={form.control}
                    name="azureOrganization"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="flex items-center gap-2">
                          <AzureIcon className="h-5 w-5 text-blue-600" />
                          Azure DevOps Organization
                        </FormLabel>
                        <FormControl>
                          <Input 
                            placeholder="Enter your Azure DevOps organization name" 
                            {...field} 
                          />
                        </FormControl>
                        <FormDescription>
                          The name of your Azure DevOps organization (e.g., 'contoso')
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="azureToken"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="flex items-center gap-2">
                          <AzureIcon className="h-5 w-5 text-blue-600" />
                          Azure DevOps PAT
                        </FormLabel>
                        <FormControl>
                          <Input 
                            type="password" 
                            placeholder="Enter your Azure DevOps PAT" 
                            {...field} 
                          />
                        </FormControl>
                        <FormDescription>
                          Create a PAT with Code (read), Build (read), and Release (read) scopes
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="githubToken"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="flex items-center gap-2">
                          <GitHubIcon className="h-5 w-5" />
                          GitHub PAT
                        </FormLabel>
                        <FormControl>
                          <Input 
                            type="password" 
                            placeholder="Enter your GitHub PAT" 
                            {...field} 
                          />
                        </FormControl>
                        <FormDescription>
                          Create a PAT with repo and workflow scopes
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <Button 
                    type="submit" 
                    className="w-full"
                    disabled={isConnecting || !isFormValid}
                  >
                    {isConnecting ? (
                      "Validating Tokens..."
                    ) : (
                      "Connect and Load Repositories"
                    )}
                  </Button>
                </form>
              </Form>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}